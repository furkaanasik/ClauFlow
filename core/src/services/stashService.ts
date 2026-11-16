import { run } from "./gitService.js";
import { tryAcquireRepoLock } from "./repoLock.js";
import { getTaskSync } from "./taskService.js";
import { getComment } from "./commentService.js";

/**
 * zincir E6 (plan §3/26–27, §5.9): the stashes ClauFlow took, read straight
 * from `git stash list` (git is the single source of truth; no table). Only
 * ClauFlow labels are listed and only those can be restored or dropped — the
 * user's own stashes are never touched. Endpoints address a stash by its
 * commit SHA (`stash@{n}` indices shift); the index is resolved under the
 * repo lock at operation time.
 */

export type StashReason = "run" | "merge" | "comment" | "resolve";

export interface StashEntry {
  /** Stash commit SHA (`%H`). */
  ref: string;
  label: string;
  reason: StashReason;
  taskId: string | null;
  displayId: string | null;
  /** ISO time the stash was taken (`%ct`). */
  createdAt: string;
  /** Files in the stash (tracked + untracked), at most `MAX_FILES`. */
  files: string[];
}

export interface ParsedStashLabel {
  reason: StashReason;
  taskId?: string;
  commentId?: string;
}

export type StashErrorCode =
  | "repo_busy"
  | "stash_not_found"
  | "worktree_dirty"
  | "stash_conflict";

export class StashError extends Error {
  readonly code: StashErrorCode;
  readonly extra: { files?: string[]; detail?: string };
  constructor(code: StashErrorCode, extra: { files?: string[]; detail?: string } = {}) {
    super(code);
    this.name = "StashError";
    this.code = code;
    this.extra = extra;
  }
}

const MAX_FILES = 20;
const ISO_TAIL = /^(?:(.+)-)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/;

/**
 * Recognises ClauFlow's stash labels (pure):
 * - `kanban-auto-<iso>` / `kanban-pull-auto-<iso>` (old run label, no task) and
 *   `kanban-auto-<taskId>-<iso>` / `kanban-pull-auto-<taskId>-<iso>` → `run`;
 * - `clauflow-merge-<taskId>` → `merge`;
 * - `clauflow-comment-<commentId>` → `comment`;
 * - `clauflow-resolve-<taskId>` → `resolve` (F4.6 conflict resolver, §3/40).
 * `clauflow-discard-*` (a run's own throwaway stashes) and anything else → null.
 */
export function parseStashLabel(label: string): ParsedStashLabel | null {
  const s = label.trim();
  const runMatch = /^kanban-(?:pull-)?auto-(.+)$/.exec(s);
  if (runMatch) {
    const tail = ISO_TAIL.exec(runMatch[1]!);
    if (tail?.[1]) return { reason: "run", taskId: tail[1] };
    return { reason: "run" };
  }
  const cf = /^clauflow-(merge|comment|resolve)-(\S+)$/.exec(s);
  if (!cf) return null;
  const kind = cf[1] as "merge" | "comment" | "resolve";
  const id = cf[2]!;
  return kind === "comment" ? { reason: "comment", commentId: id } : { reason: kind, taskId: id };
}

/** `On main: <label>` / `WIP on main: …` → `<label>`. */
function labelFromSubject(subject: string): string {
  const m = /^(?:WIP on|On) [^:]+: (.*)$/.exec(subject);
  return (m ? m[1]! : subject).trim();
}

interface RawStash {
  index: string; // stash@{n}
  sha: string;
  createdAt: string;
  label: string;
  parsed: ParsedStashLabel;
}

async function readClauflowStashes(repo: string): Promise<RawStash[]> {
  let list;
  try {
    list = await run("git", ["stash", "list", "--format=%gd%x09%H%x09%ct%x09%s"], repo);
  } catch {
    return []; // repo path missing
  }
  if (list.code !== 0) return []; // not a git repo
  const out: RawStash[] = [];
  for (const line of list.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [index, sha, ct, ...rest] = line.split("\t");
    if (!index || !sha || !ct) continue;
    const label = labelFromSubject(rest.join("\t"));
    const parsed = parseStashLabel(label);
    if (!parsed) continue;
    out.push({ index, sha, createdAt: new Date(Number(ct) * 1000).toISOString(), label, parsed });
  }
  return out;
}

async function stashFiles(repo: string, sha: string): Promise<string[]> {
  const show = await run(
    "git",
    ["stash", "show", "--name-only", "--include-untracked", sha],
    repo,
  );
  if (show.code !== 0) return [];
  return show.stdout
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .slice(0, MAX_FILES);
}

function taskIdOf(parsed: ParsedStashLabel): string | null {
  if (parsed.taskId) return parsed.taskId;
  if (parsed.commentId) {
    try {
      return getComment(parsed.commentId)?.taskId ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** ClauFlow's stashes in `repo`, newest first. Missing repo / not git → []. */
export async function listClauflowStashes(repo: string): Promise<StashEntry[]> {
  const raw = await readClauflowStashes(repo);
  const entries: StashEntry[] = [];
  for (const r of raw) {
    const taskId = taskIdOf(r.parsed);
    let displayId: string | null = null;
    if (taskId) {
      try {
        displayId = getTaskSync(taskId)?.displayId ?? null;
      } catch {
        displayId = null;
      }
    }
    entries.push({
      ref: r.sha,
      label: r.label,
      reason: r.parsed.reason,
      taskId,
      displayId,
      createdAt: r.createdAt,
      files: await stashFiles(repo, r.sha),
    });
  }
  return entries;
}

async function resolveStash(repo: string, sha: string): Promise<RawStash> {
  const found = (await readClauflowStashes(repo)).find((r) => r.sha === sha.toLowerCase());
  if (!found) throw new StashError("stash_not_found");
  return found;
}

function outText(r: { stdout: string; stderr: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).slice(0, 2000);
}

/**
 * Applies a ClauFlow stash onto a clean tree and drops it (§3/27). Never
 * waits for the lock (`repo_busy`). A conflicting apply puts the tree back to
 * its clean state and keeps the stash (`stash_conflict` + files).
 */
export async function restoreStash(
  repo: string,
  sha: string,
): Promise<{ restored: string; branch: string | null }> {
  const lease = tryAcquireRepoLock(repo, `stash:restore:${sha.slice(0, 12)}`);
  if (!lease) throw new StashError("repo_busy");
  try {
    const stash = await resolveStash(repo, sha);
    const status = await run("git", ["status", "--porcelain"], repo);
    if (status.code !== 0 || status.stdout.trim() !== "") throw new StashError("worktree_dirty");

    let apply = await run("git", ["stash", "apply", "--index", stash.sha], repo);
    if (apply.code !== 0) {
      // `--index` can refuse up front (index conflicts) without touching the
      // tree; only then is a plain apply worth one more try.
      const after = await run("git", ["status", "--porcelain"], repo);
      if (after.code === 0 && after.stdout.trim() === "") {
        apply = await run("git", ["stash", "apply", stash.sha], repo);
      }
    }
    if (apply.code !== 0) {
      const unmerged = await run("git", ["diff", "--name-only", "--diff-filter=U"], repo);
      const files = unmerged.stdout.split("\n").map((f) => f.trim()).filter(Boolean);
      // The tree was verified clean before the apply, so this only removes
      // what the failed apply brought in.
      await run("git", ["reset", "--hard", "HEAD"], repo);
      await run("git", ["clean", "-fd"], repo);
      throw new StashError("stash_conflict", { files, detail: outText(apply) });
    }

    // Indices may have moved since the lookup only if someone else touched
    // the stash list; resolve again right before dropping.
    const current = await resolveStash(repo, stash.sha).catch(() => null);
    if (current) await run("git", ["stash", "drop", current.index], repo);
    const head = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repo);
    return { restored: stash.label, branch: head.code === 0 ? head.stdout.trim() : null };
  } finally {
    lease.release();
  }
}

/** Drops one ClauFlow stash by SHA (same lock rule as restore). */
export async function dropStash(repo: string, sha: string): Promise<{ dropped: string }> {
  const lease = tryAcquireRepoLock(repo, `stash:drop:${sha.slice(0, 12)}`);
  if (!lease) throw new StashError("repo_busy");
  try {
    const stash = await resolveStash(repo, sha);
    const drop = await run("git", ["stash", "drop", stash.index], repo);
    if (drop.code !== 0) throw new StashError("stash_not_found", { detail: outText(drop) });
    return { dropped: stash.label };
  } finally {
    lease.release();
  }
}
