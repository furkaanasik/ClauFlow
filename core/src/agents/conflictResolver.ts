/**
 * Conflict resolver (zincir F4.6, plan §1 "Ek 4", §3/32–46, §5.10).
 *
 * A merge that ends in `merge_conflict` starts one automatic resolver run per
 * merge attempt: the task stays in `review` with `agent.status:
 * "resolving_conflict"`, the base is merged INTO the task branch, an AI role
 * resolves the markers, one QA round checks it, and the task is left in Review
 * for the user to approve again. The resolver never merges into the base and
 * never writes `done` (C3, §3/44).
 *
 * This file holds the run registry (RESOLVING, the executor's PENDING/RUNNING
 * pattern, §3/42), the guards' predicate, abort, and the trigger
 * (`onMergeConflict`, §3/32), and the resolver service (`startResolution`,
 * §3/35–40), its restore (`restoreFromBackup`), `mergedTasksSince` (§3/37) and
 * `baseDrift` (§3/46).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureGhCredentials,
  GhMissingError,
  pushBranch,
  run as gitRun,
  type RunResult,
} from "../services/gitService.js";
import { acquireRepoLock, type RepoLease } from "../services/repoLock.js";
import {
  appendAgentLog,
  getProject,
  getTask,
  getTaskEffectiveBudget,
  listNodeRunsByTask,
  listProjects,
  listTasks,
  updateTask,
} from "../services/taskService.js";
import { resolveTeamForTask } from "../services/teamService.js";
import { listTeamArtifactsByTask } from "../services/teamRunService.js";
import { defaultRole } from "../services/teamTemplates.js";
import {
  broadcastLog,
  broadcastStashCreated,
  broadcastStatus,
  broadcastTaskUpdated,
} from "../services/wsService.js";
import { findConflictMarkers, parseDiffCheck, parseMergeSubject } from "./conflictMarkers.js";
import { postComment } from "./executor.js";
import { RoleRunError, RoleTimeoutError, runRole } from "./roleRunner.js";
import { parseQaVerdict } from "./teamArtifacts.js";
import {
  buildConflictPrompt,
  buildConflictResolutionBlock,
  buildConflictSystemMarker,
  buildRolePrompt,
  buildRoleSystemPrompt,
  loadRoleSkills,
} from "./teamPrompts.js";
import { formatUsd, uiText, type ConflictReason, type UiLang } from "./uiText.js";
import type { Project, Task } from "../types/index.js";

export type ResolverPhase = "queued" | "running";

interface ResolveHandle {
  token: string;
  controller: AbortController;
  /** "queued" while waiting for the repo lock, "running" once it holds it. */
  phase: ResolverPhase;
}

const RESOLVING = new Map<string, ResolveHandle>();

export interface ResolutionOptions {
  /** "conflict": after a failed merge or the drawer's "Resolve with AI"; "update": "Update branch" (§3/46). */
  mode: "conflict" | "update";
  /** "auto": started by `onMergeConflict`; "manual": `POST /resolve`. */
  trigger: "auto" | "manual";
  uiLang?: UiLang;
}

/** True while a resolver run for `taskId` is queued or running in this process. */
export function isResolving(taskId: string): boolean {
  return RESOLVING.has(taskId);
}

export function resolverPhase(taskId: string): ResolverPhase | null {
  return RESOLVING.get(taskId)?.phase ?? null;
}

/**
 * Guard predicate (§3/42): a live run in the registry, or the persisted
 * `review` + `resolving_conflict` state (the gap before the run registers, or
 * a run lost to a restart until boot recovery marks it failed).
 */
export function isConflictResolving(task: Task): boolean {
  return (
    isResolving(task.id) ||
    (task.status === "review" && task.agent.status === "resolving_conflict")
  );
}

/**
 * Aborts the task's resolver run. Queued: the lock wait drops out and git is
 * never touched; running: the run restores the branch (§3/40). Either way the
 * run itself writes `conflict_unresolved:aborted`. False when there is no run.
 */
export function abortResolution(taskId: string): boolean {
  const handle = RESOLVING.get(taskId);
  if (!handle) return false;
  handle.controller.abort();
  return true;
}

/** Registers a queued run for `taskId` (or returns the one already there). */
function claimHandle(taskId: string): ResolveHandle {
  const existing = RESOLVING.get(taskId);
  if (existing) return existing;
  const handle: ResolveHandle = { token: randomUUID(), controller: new AbortController(), phase: "queued" };
  RESOLVING.set(taskId, handle);
  return handle;
}

/** Drops the registry entry only when it still belongs to `token`. */
function releaseHandle(taskId: string, token: string): void {
  if (RESOLVING.get(taskId)?.token === token) RESOLVING.delete(taskId);
}

/**
 * Test helper: registers a fake run for `taskId` (phase `phase`) without
 * starting anything, or takes over the entry already there. Returns its abort
 * signal and the cleanup that removes it.
 */
export function __setResolvingForTest(
  taskId: string,
  phase: ResolverPhase = "queued",
): { signal: AbortSignal; release: () => void } {
  const handle = claimHandle(taskId);
  handle.phase = phase;
  return { signal: handle.controller.signal, release: () => releaseHandle(taskId, handle.token) };
}

/** `currentStep` of a running resolver (§3/33). */
export type ResolverStep = "queued" | "merging" | "resolving" | "verifying" | "qa" | "pushing";

/** Ends a run with `conflict_unresolved:<reason>` (§3/33); the message goes to the log. */
class ResolveFailure extends Error {
  constructor(
    readonly reason: ConflictReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "ResolveFailure";
  }
}

const BACKUP_REF_PREFIX = "refs/clauflow/pre-resolve/";

/** Backup ref of the task branch's SHA before the run's first git write (§3/40). */
export function backupRef(taskId: string): string {
  return `${BACKUP_REF_PREFIX}${taskId}`;
}

/** Label of the stash a dirty tree goes to before the run (E6 family, §3/40). */
export function resolveStashLabel(taskId: string): string {
  return `clauflow-resolve-${taskId}`;
}

/** `git status --porcelain` XY codes git cannot express as text markers (§5.10). */
const UNSUPPORTED_XY = new Set(["DU", "UD", "AU", "UA"]);

async function git(repo: string, args: string[]): Promise<RunResult> {
  return gitRun("git", args, repo);
}

function firstLine(r: RunResult): string {
  return (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/)[0]?.slice(0, 200) ?? "";
}

async function revParse(repo: string, ref: string): Promise<string | null> {
  const r = await git(repo, ["rev-parse", "--verify", "--quiet", ref]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

async function currentBranch(repo: string): Promise<string | null> {
  const r = await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

async function inMerge(repo: string): Promise<boolean> {
  return (await revParse(repo, "MERGE_HEAD")) !== null;
}

async function hasRemote(repo: string): Promise<boolean> {
  const r = await git(repo, ["remote"]);
  return r.code === 0 && r.stdout.trim() !== "";
}

function splitLines(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function unmergedFiles(repo: string): Promise<string[]> {
  const r = await git(repo, ["diff", "--name-only", "--diff-filter=U"]);
  return r.code === 0 ? splitLines(r.stdout) : [];
}

async function readText(repo: string, rel: string): Promise<string | null> {
  try {
    return await readFile(join(repo, rel), "utf8");
  } catch {
    return null;
  }
}

/** git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
async function looksBinary(repo: string, rel: string): Promise<boolean> {
  try {
    const buf = await readFile(join(repo, rel));
    return buf.subarray(0, 8000).includes(0);
  } catch {
    return false;
  }
}

/**
 * Restores the task branch from its backup ref (§3/40) and returns the repo
 * to base: abort an open merge; on the task branch `reset --hard <pre>` +
 * `clean -fd` (the tree was clean when the run started, so this only drops
 * what the run left); elsewhere the branch ref is moved back without a
 * checkout (`ownsTree`: the run's own leftovers on that HEAD are dropped too).
 * The backup ref is deleted once the branch is back on `<pre>`; otherwise it
 * stays for boot recovery (§3/41). No ref → nothing to do.
 */
export async function restoreFromBackup(
  repo: string,
  taskId: string,
  branch: string,
  base: string,
  opts: { ownsTree: boolean; log?: (line: string) => Promise<void> } = { ownsTree: true },
): Promise<{ restored: boolean; pre: string | null }> {
  const log = opts.log ?? (async () => {});
  const ref = backupRef(taskId);
  const pre = await revParse(repo, ref);
  if (!pre) return { restored: false, pre: null };

  if (await inMerge(repo)) {
    const abort = await git(repo, ["merge", "--abort"]);
    if (abort.code !== 0) await log(`[warn] git merge --abort failed: ${firstLine(abort)}`);
  }
  const head = await currentBranch(repo);
  if (head === branch) {
    const reset = await git(repo, ["reset", "--hard", pre]);
    if (reset.code !== 0) await log(`[warn] git reset --hard failed: ${firstLine(reset)}`);
    await git(repo, ["clean", "-fd"]);
  } else {
    if (opts.ownsTree) {
      await git(repo, ["reset", "--hard", "HEAD"]);
      await git(repo, ["clean", "-fd"]);
    }
    const now = await revParse(repo, `refs/heads/${branch}`);
    if (now && now !== pre) {
      const move = await git(repo, ["update-ref", `refs/heads/${branch}`, pre, now]);
      if (move.code !== 0) await log(`[warn] git update-ref ${branch} failed: ${firstLine(move)}`);
    }
  }
  if ((await currentBranch(repo)) !== base) {
    const co = await git(repo, ["checkout", base]);
    if (co.code !== 0) await log(`[warn] git checkout ${base} failed: ${firstLine(co)}`);
  }
  const after = await revParse(repo, `refs/heads/${branch}`);
  if (after !== pre) {
    await log(`[warn] ${branch} is not back on ${pre.slice(0, 7)}; ${ref} kept for recovery`);
    return { restored: false, pre };
  }
  await git(repo, ["update-ref", "-d", ref]);
  await log(`↺ Dal geri yüklendi (${pre.slice(0, 7)})`);
  return { restored: true, pre };
}

/**
 * Tasks merged into `target` since `branch` left it (§3/37, Z41): the merge
 * commits of `<merge-base>..<target>`, matched by display id, PR number, then
 * branch name (exact, or the executor's `feature/<displayId>-…` pattern).
 * Oldest first, each task once. Merges that left no merge commit
 * (fast-forward, a skipped merge) are not found.
 */
export async function mergedTasksSince(
  repo: string,
  branch: string,
  target: string,
  projectTasks: Task[],
): Promise<Task[]> {
  const mb = await git(repo, ["merge-base", branch, target]);
  if (mb.code !== 0 || !mb.stdout.trim()) return [];
  const log = await git(repo, ["log", "--merges", "--format=%H%x09%s", `${mb.stdout.trim()}..${target}`]);
  if (log.code !== 0) return [];
  const byBranchPattern = (b: string): Task | undefined =>
    projectTasks.find((t) => {
      if (!t.displayId) return false;
      const stem = `feature/${t.displayId.toLowerCase()}`;
      return b === stem || b.startsWith(`${stem}-`);
    });
  const found: Task[] = [];
  const seen = new Set<string>();
  for (const line of splitLines(log.stdout).reverse()) {
    const subject = line.slice(line.indexOf("\t") + 1);
    const parsed = parseMergeSubject(subject);
    if (!parsed) continue;
    const task =
      (parsed.displayId
        ? projectTasks.find((t) => t.displayId?.toLowerCase() === parsed.displayId!.toLowerCase())
        : undefined) ??
      (parsed.prNumber != null ? projectTasks.find((t) => t.prNumber === parsed.prNumber) : undefined) ??
      (parsed.branch ? projectTasks.find((t) => t.branch === parsed.branch) : undefined) ??
      (parsed.branch ? byBranchPattern(parsed.branch) : undefined);
    if (task && !seen.has(task.id)) {
      seen.add(task.id);
      found.push(task);
    }
  }
  return found;
}

export interface BaseDrift {
  base: string;
  /** `origin/<base>` when the remote-tracking ref exists, else `<base>`. */
  target: string;
  /** Commits on `target` the task branch does not have. */
  behind: number;
  mergeBase: string | null;
}

/**
 * How far the base moved since the task branched (§3/46). Read-only: no
 * fetch (last fetch counts), no lock. No branch → `behind: 0`.
 */
export async function baseDrift(task: Pick<Task, "branch">, project: Pick<Project, "repoPath" | "defaultBranch">): Promise<BaseDrift> {
  const repo = project.repoPath;
  const base = project.defaultBranch;
  const target = (await revParse(repo, `refs/remotes/origin/${base}`)) ? `origin/${base}` : base;
  const branch = task.branch;
  if (!branch || !(await revParse(repo, `refs/heads/${branch}`))) {
    return { base, target, behind: 0, mergeBase: null };
  }
  const mb = await git(repo, ["merge-base", branch, target]);
  const count = await git(repo, ["rev-list", "--count", `${branch}..${target}`]);
  const behind = count.code === 0 ? Number(count.stdout.trim()) || 0 : 0;
  return { base, target, behind, mergeBase: mb.code === 0 ? mb.stdout.trim() || null : null };
}

/** What a run collected, for the summary comment. */
interface RunRecord {
  mode: ResolutionOptions["mode"];
  target: string | null;
  files: string[];
  merged: Task[];
  pre: string | null;
  /** The tree is clean (stashed if it was dirty): a restore may reset/clean it. */
  treeOwned: boolean;
  newCommit: string | null;
  clean: boolean;
  upToDate: boolean;
  note: string | null;
  qaVerdict: "pass" | "fail" | null;
  qaReport: string | null;
}

const NOTE_CHAR_CAP = 4_000;

function capText(text: string): string {
  const t = text.trim();
  return t.length > NOTE_CHAR_CAP ? `${t.slice(0, NOTE_CHAR_CAP)}\n…` : t;
}

/** Summary comment (§5.10): result, QA, cost, target, files, merged tasks, commit or restore, note, QA report. */
function buildResolverSummary(
  rec: RunRecord,
  outcome: { ok: true } | { ok: false; reason: ConflictReason },
  costUsd: number,
  lang: UiLang | undefined,
): string {
  const tx = uiText(lang).resolver;
  const result = outcome.ok
    ? rec.clean
      ? tx.clean
      : tx.resolved
    : tx.unresolved(tx.reason[outcome.reason]);
  const qa = rec.qaVerdict ? rec.qaVerdict.toUpperCase() : tx.qaSkipped;
  const head = [
    `**${tx.result}:** ${result}`,
    `**${tx.qa}:** ${qa}`,
    `**${tx.cost}:** ${formatUsd(costUsd, 4)}`,
  ].join(" · ");
  const lines: string[] = [];
  if (rec.target) lines.push(`- ${tx.target}: \`${rec.target}\``);
  if (rec.files.length > 0) lines.push(`- ${tx.files}: ${rec.files.map((f) => `\`${f}\``).join(", ")}`);
  if (rec.merged.length > 0) {
    lines.push(`- ${tx.mergedTasks}: ${rec.merged.map((t) => t.displayId ?? t.title).join(", ")}`);
  }
  if (outcome.ok) {
    if (rec.newCommit) lines.push(`- ${tx.newCommit(rec.newCommit.slice(0, 7))}`);
    else if (rec.upToDate) lines.push(`- ${tx.upToDate}`);
  } else if (rec.pre) {
    lines.push(`- ${tx.restored(rec.pre.slice(0, 7))}`);
  }
  const parts = [tx.title, head, lines.join("\n")];
  if (outcome.ok && rec.clean) parts.push(tx.cleanNote(rec.mode));
  if (rec.note?.trim()) parts.push(`${tx.note}\n\n${capText(rec.note)}`);
  if (rec.qaReport?.trim()) parts.push(`${tx.qaReport}\n\n${capText(rec.qaReport)}`);
  return parts.filter(Boolean).join("\n\n");
}

async function setStep(taskId: string, step: ResolverStep, extra: Partial<Task["agent"]> = {}): Promise<void> {
  const t = await updateTask(taskId, { agent: { status: "resolving_conflict", currentStep: step, ...extra } });
  broadcastStatus(taskId, "resolving_conflict", step);
  broadcastTaskUpdated(t);
}

function resolverRound(taskId: string): number {
  return listNodeRunsByTask(taskId).filter((r) => r.nodeId.startsWith("role:resolve:")).length + 1;
}

function classify(err: unknown, signal: AbortSignal): ConflictReason {
  if (err instanceof ResolveFailure) return err.reason;
  if (err instanceof RoleTimeoutError) return "role_timeout";
  if (err instanceof RoleRunError) return err.aborted ? "aborted" : /^claude CLI exited/.test(err.message) ? "claude_exit" : "git";
  if (signal.aborted) return "aborted";
  return "git";
}

/**
 * Runs the resolver for a task in `review` (§5.10 flow, §3/35–40). Reuses the
 * queued handle `onMergeConflict` registered, or registers one.
 *
 * lock (FIFO, abortable) → backup ref → [dirty → `clauflow-resolve-<id>`
 * stash] → checkout branch → [remote → fetch origin <base>] → `merge --no-ff
 * --no-commit <target>`:
 * - clean: commit, [push], back to base, `done`/`branch_updated`, no AI, no QA (§3/39);
 * - conflict: [binary / delete-modify → `unsupported`] → resolver role →
 *   verification (§3/38) → commit → one QA round → PASS → [push] → back to
 *   base → `done`/`conflict_resolved` + summary comment.
 * Every failure restores the branch (§3/40) and ends `conflict_unresolved:<reason>`.
 * The task stays in `review`: the resolver never writes `done` and never
 * merges the task branch into the base (C3, §3/44).
 */
export async function startResolution(taskId: string, opts: ResolutionOptions): Promise<void> {
  const handle = claimHandle(taskId);
  const signal = handle.controller.signal;
  let lease: RepoLease | null = null;
  const rec: RunRecord = {
    mode: opts.mode,
    target: null,
    files: [],
    merged: [],
    pre: null,
    treeOwned: false,
    newCommit: null,
    clean: false,
    upToDate: false,
    note: null,
    qaVerdict: null,
    qaReport: null,
  };
  let task: Task | null = null;
  let project: Project | null = null;
  let costBefore = 0;
  const log = (line: string) => logLine(taskId, line);
  try {
    task = await getTask(taskId);
    if (!task) {
      console.warn(`[resolver] task ${taskId} not found`);
      return;
    }
    costBefore = task.costUsd ?? 0;
    project = await getProject(task.projectId);
    if (!project) throw new ResolveFailure("git", `project not found: ${task.projectId}`);
    if (task.agent.status !== "resolving_conflict") {
      const now = new Date().toISOString();
      await setStep(taskId, "queued", { error: null, startedAt: now, finishedAt: null });
      await log(`▸ AI conflict resolver queued (${opts.mode}, ${opts.trigger})`);
    }

    try {
      lease = await acquireRepoLock(project.repoPath, { owner: `resolve:${taskId}`, signal });
    } catch (e) {
      if (signal.aborted) throw new ResolveFailure("aborted", "aborted while waiting for the repo lock");
      throw e;
    }
    handle.phase = "running";
    await resolveUnderLock(taskId, project, opts, rec, signal, log);
    // A clean merge ran no AI and no QA (§3/39): it ends as `branch_updated`, so
    // the GUI does not claim "conflict resolved; QA: PASS" (F4.6 decision, §10).
    const endStep = rec.clean ? "branch_updated" : "conflict_resolved";
    const final = await updateTask(taskId, {
      agent: { status: "done", currentStep: endStep, error: null, finishedAt: new Date().toISOString() },
    });
    broadcastStatus(taskId, "done", endStep);
    broadcastTaskUpdated(final);
    await log(rec.clean ? "✓ Ana dal temiz birleşti (QA atlandı)" : "✓ Çakışma çözüldü; tekrar onay bekleniyor");
    postComment(
      taskId,
      buildResolverSummary(rec, { ok: true }, Math.max(0, (final.costUsd ?? 0) - costBefore), opts.uiLang),
      "resolver",
    );
  } catch (err) {
    const reason = classify(err, signal);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[resolver] task ${taskId}: ${reason}: ${message}`);
    await log(`[error] conflict_unresolved:${reason}${message !== reason ? ` (${message.split("\n")[0]})` : ""}`).catch(
      () => {},
    );
    if (project && task?.branch && rec.pre) {
      try {
        if (rec.treeOwned) {
          await restoreFromBackup(project.repoPath, taskId, task.branch, project.defaultBranch, { ownsTree: true, log });
        } else {
          // Only the backup ref was written; the user's dirty tree stays as it is.
          await gitRun("git", ["update-ref", "-d", backupRef(taskId)], project.repoPath);
        }
      } catch (e) {
        console.warn(`[resolver] restore failed for ${taskId}:`, e);
      }
    }
    const failed = await updateTask(taskId, {
      agent: {
        status: "error",
        currentStep: undefined,
        error: `conflict_unresolved:${reason}`,
        finishedAt: new Date().toISOString(),
      },
    }).catch(() => null);
    if (failed) {
      broadcastStatus(taskId, "error");
      broadcastTaskUpdated(failed);
      postComment(
        taskId,
        buildResolverSummary(rec, { ok: false, reason }, Math.max(0, (failed.costUsd ?? 0) - costBefore), opts.uiLang),
        "resolver",
      );
    }
  } finally {
    lease?.release();
    releaseHandle(taskId, handle.token);
  }
}

/** The run's body under the repo lock; throws to fail (the caller restores). */
async function resolveUnderLock(
  taskId: string,
  project: Project,
  opts: ResolutionOptions,
  rec: RunRecord,
  signal: AbortSignal,
  log: (line: string) => Promise<void>,
): Promise<void> {
  const repo = project.repoPath;
  const base = project.defaultBranch;
  const checkAbort = (): void => {
    if (signal.aborted) throw new ResolveFailure("aborted");
  };
  checkAbort();

  // Fresh row under the lock (the queue may have waited behind another run).
  const task = await getTask(taskId);
  if (!task) throw new ResolveFailure("git", "task not found");
  if (task.status !== "review") throw new ResolveFailure("git", "task_not_in_review");
  const branch = task.branch;
  if (!branch || !/^[a-zA-Z0-9._/-]+$/.test(branch)) throw new ResolveFailure("git", "no_branch");
  const pre = await revParse(repo, `refs/heads/${branch}`);
  if (!pre) throw new ResolveFailure("git", "no_branch");
  const remote = await hasRemote(repo);
  if (remote) {
    try {
      await ensureGhCredentials(repo);
    } catch (e) {
      throw new ResolveFailure("git", e instanceof GhMissingError ? "gh_missing" : String(e));
    }
  }

  await setStep(taskId, "merging");
  // ── backup ref before any git write (§3/40) ────────────────────────────
  const backup = await git(repo, ["update-ref", backupRef(taskId), pre]);
  if (backup.code !== 0) throw new ResolveFailure("git", `git update-ref failed: ${firstLine(backup)}`);
  rec.pre = pre;

  // ── a dirty tree goes aside first (E6 family) ──────────────────────────
  const dirty = await git(repo, ["status", "--porcelain"]);
  if (dirty.code === 0 && dirty.stdout.trim()) {
    const label = resolveStashLabel(taskId);
    const stash = await git(repo, ["stash", "push", "--include-untracked", "--message", label]);
    if (stash.code !== 0) throw new ResolveFailure("git", `git stash failed: ${firstLine(stash)}`);
    await log(`↺ Çalışma ağacı kirliydi; stash'e alındı (${label})`);
    broadcastStashCreated(taskId, {
      projectId: project.id,
      label,
      reason: "resolve",
      displayId: task.displayId ?? null,
    });
  }
  rec.treeOwned = true;

  const co = await git(repo, ["checkout", branch]);
  if (co.code !== 0) throw new ResolveFailure("git", `git checkout ${branch} failed: ${firstLine(co)}`);
  checkAbort();

  let target = base;
  if (remote) {
    const fetch = await git(repo, ["fetch", "origin", base]);
    if (fetch.code !== 0) throw new ResolveFailure("git", `git fetch origin ${base} failed: ${firstLine(fetch)}`);
    target = `origin/${base}`;
  }
  rec.target = target;
  const tasks = (await listTasks(project.id)).filter((t) => t.id !== taskId);
  rec.merged = await mergedTasksSince(repo, branch, target, tasks);
  checkAbort();

  const ref = task.displayId ?? task.id;
  // rerere off: a user's global `rerere.enabled`/`autoupdate` could replay a
  // recorded resolution and stage it, hiding the conflict from the resolver
  // and from the marker checks (§3/38).
  const merge = await git(repo, ["-c", "rerere.enabled=false", "merge", "--no-ff", "--no-commit", target]);

  // ── clean merge: no AI, no QA (§3/39) ─────────────────────────────────
  if (merge.code === 0) {
    rec.clean = true;
    if (await inMerge(repo)) {
      const msg = `Merge ${target} into ${branch} (${ref}): updated by ClauFlow`;
      const commit = await git(repo, ["commit", "--no-edit", "-m", msg]);
      if (commit.code !== 0) throw new ResolveFailure("git", `git commit failed: ${firstLine(commit)}`);
      rec.newCommit = await revParse(repo, "HEAD");
      await log(`✓ ${target} → ${branch} temiz birleşti (${rec.newCommit?.slice(0, 7)})`);
    } else {
      rec.upToDate = true;
      await log(`ℹ ${branch} zaten ${target}'in güncel hâlini içeriyor`);
    }
    checkAbort();
    if (remote && rec.newCommit) await pushStep(taskId, repo, branch, log);
    await finishOnBase(repo, taskId, base, log);
    return;
  }

  // ── conflict ──────────────────────────────────────────────────────────
  if (!(await inMerge(repo))) throw new ResolveFailure("git", `git merge failed: ${firstLine(merge)}`);
  const files = await unmergedFiles(repo);
  if (files.length === 0) throw new ResolveFailure("git", `git merge failed without conflicted files: ${firstLine(merge)}`);
  rec.files = files;
  await log(`▸ Çakışma çözücü: ${target} → ${branch} (${files.length} dosya: ${files.join(", ")})`);

  const status = await git(repo, ["status", "--porcelain"]);
  const unsupportedPaths = splitLines(status.stdout)
    .filter((l) => UNSUPPORTED_XY.has(l.slice(0, 2)))
    .map((l) => l.slice(3));
  const binary: string[] = [];
  for (const f of files) if (await looksBinary(repo, f)) binary.push(f);
  if (unsupportedPaths.length > 0 || binary.length > 0 || /Cannot merge binary files/i.test(merge.stdout + merge.stderr)) {
    throw new ResolveFailure(
      "unsupported",
      `unsupported conflict: ${[...unsupportedPaths.map((p) => `${p} (delete/modify)`), ...binary.map((p) => `${p} (binary)`)].join(", ") || "binary"}`,
    );
  }
  checkAbort();

  // ── resolver role (§3/35) ─────────────────────────────────────────────
  await setStep(taskId, "resolving");
  const team = resolveTeamForTask(task, project);
  const role = team.roles.find((r) => r.kind === "developer") ?? defaultRole("developer");
  const n = resolverRound(taskId);
  await log(`▸ Rol: ${role.name} (${team.name}, çözücü turu ${n}, model ${role.model})`);
  const { skills, missing } = await loadRoleSkills(role.skills, repo);
  const system = buildRoleSystemPrompt(role, n, skills, { marker: buildConflictSystemMarker(n) });
  if (system.skills.injected.length > 0) await log(`⚡ Skills injected: ${system.skills.injected.join(", ")}`);
  if (missing.length > 0) await log(`[warn] Skill bulunamadı: ${missing.join(", ")}`);

  const artifacts = listTeamArtifactsByTask(taskId);
  const spec = [...artifacts].reverse().find((a) => a.kind === "spec")?.body ?? null;
  const conflicts = [];
  for (const path of files) conflicts.push({ path, text: await readText(repo, path) });
  const prompt = buildConflictPrompt({
    task,
    project,
    spec,
    target,
    branch,
    mergedTasks: rec.merged,
    conflicts,
    uiLang: opts.uiLang,
  });
  const budgetUsd = getTaskEffectiveBudget(taskId);
  const budgetContext = {
    taskTitle: task.title,
    displayId: task.displayId ?? null,
    projectId: project.id,
    projectName: project.name,
  };
  const resolved = await runRole({
    taskId,
    cwd: repo,
    signal,
    nodeId: `role:resolve:${n}`,
    nodeType: "developer",
    prompt,
    appendSystemPrompt: system.text,
    model: role.model,
    advisorModel: role.advisorModel,
    tools: role.tools,
    isolate: true,
    budgetUsd,
    spentBeforeUsd: 0,
    budgetContext,
    inputArtifact: { roleId: role.id, round: n, team: team.name, resolver: true, target, files },
  });
  rec.note = resolved.finalText || null;
  if (resolved.budgetExceeded) throw new ResolveFailure("budget");
  checkAbort();

  // ── verification (§3/38) ──────────────────────────────────────────────
  await setStep(taskId, "verifying");
  if ((await currentBranch(repo)) !== branch || !(await inMerge(repo))) {
    throw new ResolveFailure("git", "the resolver changed HEAD or ended the merge");
  }
  for (const f of files) {
    const text = await readText(repo, f);
    if (text !== null && findConflictMarkers(text).length > 0) {
      throw new ResolveFailure("markers_left", `conflict markers left in ${f}`);
    }
  }
  const check = await git(repo, ["diff", "--check"]);
  const leftover = parseDiffCheck(check.stdout);
  if (leftover.length > 0) throw new ResolveFailure("markers_left", `git diff --check: ${leftover[0]}`);
  const add = await git(repo, ["add", "-A"]);
  if (add.code !== 0) throw new ResolveFailure("git", `git add failed: ${firstLine(add)}`);
  const stillU = await git(repo, ["diff", "--cached", "--name-only", "--diff-filter=U"]);
  if (splitLines(stillU.stdout).length > 0) {
    throw new ResolveFailure("markers_left", `still unmerged: ${splitLines(stillU.stdout).join(", ")}`);
  }
  const existing: string[] = [];
  for (const f of files) if ((await readText(repo, f)) !== null) existing.push(f);
  if (existing.length > 0) {
    const grep = await git(repo, ["grep", "-n", "-I", "-E", "^(<{7}|>{7})( |$)", "--", ...existing]);
    if (grep.code === 0 && grep.stdout.trim()) {
      throw new ResolveFailure("markers_left", `git grep: ${splitLines(grep.stdout)[0]}`);
    }
  }
  await log("✓ İşaretçi kalmadı");
  const msg = `Merge ${target} into ${branch} (${ref}): conflicts resolved by ClauFlow`;
  const commit = await git(repo, ["commit", "--no-edit", "-m", msg]);
  if (commit.code !== 0) throw new ResolveFailure("git", `git commit failed: ${firstLine(commit)}`);
  const newCommit = await revParse(repo, "HEAD");
  rec.newCommit = newCommit;
  await log(`▸ git commit: ${msg} (${newCommit?.slice(0, 7)})`);
  checkAbort();

  // ── one QA round (§3/35) ──────────────────────────────────────────────
  await setStep(taskId, "qa");
  const qaRole = team.roles.find((r) => r.kind === "qa") ?? defaultRole("qa");
  await log(`▸ Rol: ${qaRole.name} (çözücü QA turu ${n}, model ${qaRole.model})`);
  const qaSkills = await loadRoleSkills(qaRole.skills, repo);
  const qaSystem = buildRoleSystemPrompt(qaRole, n, qaSkills.skills);
  const diff = await git(repo, ["diff", `${target}...HEAD`]);
  const qaPrompt = [
    buildRolePrompt(qaRole, {
      task,
      project,
      round: n,
      solo: false,
      spec,
      delivery: rec.note,
      diff: diff.code === 0 ? diff.stdout : null,
      baseBranch: target,
    }),
    buildConflictResolutionBlock(target, files, rec.note ?? ""),
  ].join("\n\n");
  const qa = await runRole({
    taskId,
    cwd: repo,
    signal,
    nodeId: `role:resolve-qa:${n}`,
    nodeType: "qa",
    prompt: qaPrompt,
    appendSystemPrompt: qaSystem.text,
    model: qaRole.model,
    advisorModel: qaRole.advisorModel,
    tools: qaRole.tools,
    isolate: true,
    budgetUsd,
    spentBeforeUsd: resolved.costUsd,
    budgetContext,
    inputArtifact: { roleId: qaRole.id, round: n, team: team.name, resolver: true },
  });
  rec.qaReport = qa.finalText || null;
  const verdict = parseQaVerdict(qa.finalText);
  rec.qaVerdict = verdict.verdict;
  await log(`▸ QA kararı: ${verdict.verdict === "pass" ? "PASS" : "FAIL"}`);
  if (qa.budgetExceeded) throw new ResolveFailure("budget");
  checkAbort();
  // QA must not change anything; drop what it left (the tree was clean).
  const qaDirty = await git(repo, ["status", "--porcelain"]);
  if (qaDirty.code === 0 && qaDirty.stdout.trim()) {
    await git(repo, ["reset", "--hard", "HEAD"]);
    await git(repo, ["clean", "-fd"]);
    await log("↺ QA çalışma ağacını değiştirdi; değişiklikler atıldı");
  }
  if ((await currentBranch(repo)) !== branch || (await revParse(repo, "HEAD")) !== newCommit) {
    throw new ResolveFailure("git", "QA moved HEAD");
  }
  if (verdict.verdict !== "pass") throw new ResolveFailure("qa_fail");

  // ── push last, only after PASS (§3/40) ────────────────────────────────
  if (remote) await pushStep(taskId, repo, branch, log);
  await finishOnBase(repo, taskId, base, log);
}

async function pushStep(
  taskId: string,
  repo: string,
  branch: string,
  log: (line: string) => Promise<void>,
): Promise<void> {
  await setStep(taskId, "pushing");
  const push = await pushBranch(repo, branch);
  if (push.code !== 0) throw new ResolveFailure("push_failed", `git push failed: ${firstLine(push)}`);
  await log(`▸ git push --force-with-lease origin ${branch}`);
}

/** Success: back to base, backup ref dropped. */
async function finishOnBase(
  repo: string,
  taskId: string,
  base: string,
  log: (line: string) => Promise<void>,
): Promise<void> {
  const co = await git(repo, ["checkout", base]);
  if (co.code !== 0) await log(`[warn] git checkout ${base} failed: ${firstLine(co)}`);
  else await log(`↺ ${base} dalına dönüldü`);
  await git(repo, ["update-ref", "-d", backupRef(taskId)]);
}

/**
 * Indirection for the deferred start, so tests can spy on (and stub) it:
 * an ESM module's internal call cannot be intercepted otherwise.
 */
export const resolverRuntime = {
  startResolution: (taskId: string, opts: ResolutionOptions): Promise<void> => startResolution(taskId, opts),
};

async function logLine(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}

/**
 * The trigger (§3/32, C1, C4): called by a merge attempt (PATCH review→done,
 * the PR drawer's merge) that ended in `merge_conflict`, before it answers 409.
 *
 * - The task's current `agent.error` is `conflict_unresolved:*`: the previous
 *   automatic attempt failed and the user did nothing else since. No new run;
 *   `agent.error = "merge_conflict"` as before F4.6, `{ resolving: false }`
 *   (a new attempt only from the drawer's "Resolve with AI").
 * - Otherwise: `review` / `resolving_conflict` / `queued`, a queued registry
 *   entry, and `startResolution` deferred with `setImmediate`, so the caller's
 *   409 goes out first. `{ resolving: true }`.
 *
 * Only one automatic attempt per merge attempt, and no loop: the resolver
 * never merges, so a new merge attempt only comes from the user.
 */
export async function onMergeConflict(
  task: Task,
  project: Project,
  files: string[],
  uiLang?: UiLang,
): Promise<{ resolving: boolean }> {
  void project;
  // A run is already on it (the merge routes' guards make this unreachable).
  if (isResolving(task.id)) return { resolving: true };
  const now = new Date().toISOString();
  if (task.agent.error?.startsWith("conflict_unresolved")) {
    const errTask = await updateTask(task.id, {
      agent: { status: "error", currentStep: undefined, error: "merge_conflict", finishedAt: now },
    });
    broadcastTaskUpdated(errTask);
    return { resolving: false };
  }

  claimHandle(task.id);
  const queued = await updateTask(task.id, {
    agent: {
      status: "resolving_conflict",
      currentStep: "queued",
      error: null,
      startedAt: now,
      finishedAt: null,
    },
  });
  broadcastTaskUpdated(queued);
  await logLine(
    task.id,
    `▸ Merge conflict${files.length ? ` (${files.join(", ")})` : ""}; AI conflict resolver queued`,
  );
  setImmediate(() => {
    resolverRuntime
      .startResolution(task.id, { mode: "conflict", trigger: "auto", uiLang })
      .catch((err) => console.error("[resolver]", err));
  });
  return { resolving: true };
}

/**
 * Manual start (`POST /api/tasks/:id/resolve`, §3/46, §5.10): the drawer's
 * "Resolve with AI" (`conflict`) or "Update branch" (`update`). The route has
 * checked the task (review, branch, not resolving, drift for `update`). Like
 * the trigger, it registers the queued run and writes `review` /
 * `resolving_conflict` / `queued` before answering, then defers the start.
 * Returns the queued row for the 202.
 */
export async function requestResolution(
  task: Task,
  opts: { mode: ResolutionOptions["mode"]; uiLang?: UiLang },
): Promise<Task> {
  claimHandle(task.id);
  const queued = await updateTask(task.id, {
    agent: {
      status: "resolving_conflict",
      currentStep: "queued",
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
  });
  broadcastTaskUpdated(queued);
  await logLine(task.id, `▸ AI conflict resolver queued (${opts.mode}, manual)`);
  setImmediate(() => {
    resolverRuntime
      .startResolution(task.id, { mode: opts.mode, trigger: "manual", uiLang: opts.uiLang })
      .catch((err) => console.error("[resolver]", err));
  });
  return queued;
}

export interface ConflictRecovery {
  /** Tasks whose branch was put back on its backup SHA. */
  restored: string[];
  /** Backup refs left in place (unknown task, no branch, restore failed). */
  kept: string[];
}

/**
 * Boot recovery (§3/41, Z36): a resolver run killed by a restart may have left
 * its repo on the task branch, mid-merge, or with an unreviewed merge commit.
 * Only repos holding a `refs/clauflow/pre-resolve/<taskId>` ref are touched:
 * that ref is the proof the state is ClauFlow's, so user branches stay as they
 * are. Each ref gets §3/40's restore without the lock (no run is alive at
 * boot) and with `ownsTree: false` (the tree may be the user's if the run died
 * before its stash). The row itself is closed by `recoverOrphans`
 * (`conflict_unresolved:server_restart`). Errors (a missing repo included)
 * only warn; the ref stays.
 */
export async function recoverConflictRuns(): Promise<ConflictRecovery> {
  const result: ConflictRecovery = { restored: [], kept: [] };
  const projects = await listProjects();
  const repos = new Map<string, Project>();
  for (const p of projects) if (!repos.has(p.repoPath)) repos.set(p.repoPath, p);

  for (const repo of repos.keys()) {
    if (!existsSync(repo)) {
      console.warn(`[resolver] boot: repo not found, skipped: ${repo}`);
      continue;
    }
    let refs: string[];
    try {
      const r = await git(repo, ["for-each-ref", "--format=%(refname)", BACKUP_REF_PREFIX]);
      if (r.code !== 0) continue;
      refs = splitLines(r.stdout);
    } catch {
      continue;
    }
    for (const ref of refs) {
      const taskId = ref.slice(BACKUP_REF_PREFIX.length);
      try {
        const task = await getTask(taskId);
        const project = task ? projects.find((p) => p.id === task.projectId) : undefined;
        if (!task || !project || project.repoPath !== repo || !task.branch) {
          console.warn(`[resolver] boot: ${ref} in ${repo} has no matching task branch; left in place`);
          result.kept.push(taskId);
          continue;
        }
        const log = (line: string) => logLine(taskId, line);
        await log(`↺ Boot: interrupted conflict resolver run found (${ref}); restoring ${task.branch}`);
        const r = await restoreFromBackup(repo, taskId, task.branch, project.defaultBranch, { ownsTree: false, log });
        if (r.restored) result.restored.push(taskId);
        else result.kept.push(taskId);
      } catch (err) {
        console.warn(`[resolver] boot: restoring ${ref} in ${repo} failed:`, err);
        result.kept.push(taskId);
      }
    }
  }
  return result;
}
