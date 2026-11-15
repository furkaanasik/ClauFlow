import { randomUUID } from "node:crypto";
import {
  checkoutBase,
  createBranch,
  commitAll,
  pushBranch,
  createPr,
  run as gitRun,
} from "../services/gitService.js";
import { buildPrTeamSection, runTeam, type TeamStopReason } from "./teamRunner.js";
import {
  appendAgentLog,
  getTask,
  resetTaskUsage,
  updateTask,
} from "../services/taskService.js";
import { getLatestTeamRun } from "../services/teamRunService.js";
import { slugify } from "../services/slug.js";
import {
  broadcastCommentUpdated,
  broadcastLog,
  broadcastStatus,
  broadcastTaskUpdated,
} from "../services/wsService.js";
import { createComment, updateComment } from "../services/commentService.js";
import { acquireRepoLock, type RepoLease } from "../services/repoLock.js";
import type { AgentStatus, Project, Task } from "../types/index.js";

interface RunHandle {
  token: string;
  controller: AbortController;
}

// PENDING: enqueued, waiting for the repo lock. RUNNING: holds the lock.
// LATEST: the newest run token per task; an older run that unwinds after a
// retry must not overwrite the newer run's task state or map entries.
const PENDING = new Map<string, RunHandle>();
const RUNNING = new Map<string, RunHandle>();
const LATEST = new Map<string, string>();

export function abort(taskId: string): boolean {
  const handles = [PENDING.get(taskId), RUNNING.get(taskId)].filter(
    (h): h is RunHandle => !!h,
  );
  for (const h of handles) h.controller.abort();
  return handles.length > 0;
}

export function isRunning(taskId: string): boolean {
  return PENDING.has(taskId) || RUNNING.has(taskId);
}

/** "queued" while waiting for the repo lock, "running" once it holds it. */
export function runPhase(taskId: string): "queued" | "running" | null {
  if (RUNNING.has(taskId)) return "running";
  if (PENDING.has(taskId)) return "queued";
  return null;
}

function holds(map: Map<string, RunHandle>, taskId: string, token: string): boolean {
  return map.get(taskId)?.token === token;
}

/**
 * Resolves once the runs that exist for `taskId` right now have unwound, or
 * after `timeoutMs`. A run enqueued after this call is not waited for.
 */
export async function waitForIdle(taskId: string, timeoutMs = 5000): Promise<void> {
  const tokens = [PENDING.get(taskId)?.token, RUNNING.get(taskId)?.token].filter(
    (t): t is string => !!t,
  );
  const start = Date.now();
  while (tokens.some((t) => holds(PENDING, taskId, t) || holds(RUNNING, taskId, t))) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function enqueue(task: Task, project: Project): void {
  run(task, project).catch(() => {}); // errors handled inside run()
}

async function setAgentStep(
  taskId: string,
  status: AgentStatus,
  currentStep: string,
): Promise<void> {
  const t = await updateTask(taskId, { agent: { status, currentStep } });
  broadcastStatus(taskId, status, currentStep);
  broadcastTaskUpdated(t);
}

async function pushLog(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}

async function pushBlock(taskId: string, lines: string[]): Promise<void> {
  for (const line of lines) {
    await pushLog(taskId, line);
  }
}

async function pushCmdResult(
  taskId: string,
  result: { code: number; stdout: string; stderr: string },
): Promise<void> {
  const out = result.stdout.trim();
  const err = result.stderr.trim();
  if (out) {
    for (const ln of out.split(/\r?\n/)) await pushLog(taskId, ln);
  }
  if (err) {
    for (const ln of err.split(/\r?\n/)) await pushLog(taskId, `[stderr] ${ln}`);
  }
}

function extractAcceptanceCriteria(analysis: string | undefined | null): string | null {
  if (!analysis) return null;
  const m = analysis.match(
    /\*\*Acceptance criteria\*\*\s*\n([\s\S]*?)(?=\n\s*(?:\*\*[^*]|##\s|$))/i,
  );
  return m && m[1] ? m[1].trim() : null;
}

function buildBranchName(task: Task): string {
  const titleSlug = slugify(task.title, 40);
  if (task.displayId) {
    const idPart = task.displayId.toLowerCase();
    return titleSlug ? `feature/${idPart}-${titleSlug}` : `feature/${idPart}`;
  }
  return `feature/issue-${task.id}`;
}

function taskRef(task: Task): string {
  return task.displayId ?? task.id;
}

function postComment(taskId: string, body: string, label: string): void {
  try {
    const comment = createComment(taskId, body);
    const done = updateComment(comment.id, { status: "done" });
    broadcastCommentUpdated(done);
  } catch (e) {
    console.error(`[executor] auto-comment (${label}) failed:`, e);
  }
}

async function returnToBase(
  taskId: string,
  project: Project,
  branch: string,
  opts: { deleteBranch: boolean },
): Promise<void> {
  const co = await gitRun("git", ["checkout", project.defaultBranch], project.repoPath);
  if (co.code !== 0) {
    await pushLog(taskId, `[warn] git checkout ${project.defaultBranch} failed: ${co.stderr.trim()}`);
    return;
  }
  if (opts.deleteBranch) {
    await gitRun("git", ["branch", "-D", branch], project.repoPath);
    await pushLog(taskId, `↺ Returned to ${project.defaultBranch}, dropped ${branch}`);
  } else {
    await pushLog(taskId, `↺ Returned to ${project.defaultBranch}; ${branch} kept`);
  }
}

/**
 * Stuck / round limit / budget (plan §3): keep the work as a `wip:` commit on
 * the task branch, return to base without deleting the branch, and hand the
 * task back as todo + error.
 */
async function stopStuck(
  task: Task,
  project: Project,
  branch: string,
  reason: TeamStopReason,
  reasonText: string,
  summary: string,
): Promise<void> {
  const dirty = await gitRun("git", ["status", "--porcelain"], project.repoPath);
  if (dirty.code === 0 && dirty.stdout.trim()) {
    const wip = await commitAll(project.repoPath, `wip: ${taskRef(task)} takıldı (${reasonText})`);
    await pushCmdResult(task.id, wip);
  }
  await returnToBase(task.id, project, branch, { deleteBranch: false });
  postComment(task.id, summary, "stuck");
  const errTask = await updateTask(task.id, {
    status: "todo",
    agent: {
      status: "error",
      currentStep: undefined,
      error: `stuck_${reason}`,
      finishedAt: new Date().toISOString(),
    },
  });
  broadcastStatus(task.id, "error");
  broadcastTaskUpdated(errTask);
}

/**
 * A3/A4: never delete a branch that carries work. A previous run's branch that
 * is ahead of base (e.g. a `wip:` commit from a stuck run) is renamed to
 * `<branch>-wip-N` (first free N); an empty one is dropped.
 */
async function setAsideOldBranch(taskId: string, project: Project, branch: string): Promise<void> {
  const exists = await gitRun("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], project.repoPath);
  if (exists.code !== 0) return;
  const ahead = await gitRun(
    "git",
    ["rev-list", "--count", `${project.defaultBranch}..${branch}`],
    project.repoPath,
  );
  if ((Number.parseInt(ahead.stdout.trim(), 10) || 0) === 0) {
    await gitRun("git", ["branch", "-D", branch], project.repoPath);
    return;
  }
  for (let n = 1; n < 1000; n++) {
    const wip = `${branch}-wip-${n}`;
    const taken = await gitRun("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${wip}`], project.repoPath);
    if (taken.code === 0) continue;
    const mv = await gitRun("git", ["branch", "-m", branch, wip], project.repoPath);
    if (mv.code !== 0) throw new Error(`git branch -m ${branch} ${wip} failed:\n${mv.stderr}`);
    await pushLog(taskId, `↺ Önceki koşunun dalı korundu: ${wip}`);
    return;
  }
  throw new Error(`no free -wip-N name for ${branch}`);
}

class QueuedAbort extends Error {}

export async function run(task: Task, project: Project): Promise<void> {
  const token = randomUUID();
  const controller = new AbortController();
  const handle: RunHandle = { token, controller };
  PENDING.set(task.id, handle);
  LATEST.set(task.id, token);
  const isLatest = () => LATEST.get(task.id) === token;

  const branch = buildBranchName(task);
  const ref = taskRef(task);
  let lease: RepoLease | null = null;
  let createdBranch = false;

  try {
    // Wait (FIFO, no timeout) until no other run/comment/merge touches this repo.
    try {
      lease = await acquireRepoLock(project.repoPath, {
        owner: `task:${task.id}:${token}`,
        signal: controller.signal,
      });
    } catch {
      throw new QueuedAbort();
    }
    if (holds(PENDING, task.id, token)) PENDING.delete(task.id);
    RUNNING.set(task.id, handle);
    if (controller.signal.aborted) throw new QueuedAbort();

    // Stamp start time
    const startTask = await updateTask(task.id, {
      agent: {
        status: "branching",
        currentStep: "start",
        log: [],
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
    });
    broadcastStatus(task.id, "branching", "start");
    broadcastTaskUpdated(startTask);

    await pushLog(task.id, `▸ Feature: ${ref}`);

    // Resuming after spec approval keeps the usage of the roles that already ran.
    if (getLatestTeamRun(task.id)?.status !== "awaiting_approval") resetTaskUsage(task.id);

    // ── Step 0: refresh git credential helper ─────────────────────────────
    // Ensures gh's git credential helper is registered even if auth was
    // already completed in a previous session.
    await gitRun("gh", ["auth", "setup-git"], project.repoPath);

    // ── Step 1: checkout base + pull ──────────────────────────────────────
    await setAgentStep(task.id, "branching", "checkout_base");
    const coResult = await checkoutBase(project.repoPath, project.defaultBranch);
    if (coResult.code !== 0) {
      throw new Error(`git checkout/pull failed:\n${coResult.stderr}`);
    }
    if (/\[kanban\] working tree had dirty files/.test(coResult.stdout)) {
      await pushCmdResult(task.id, coResult);
    }

    // ── Step 2: create feature branch ────────────────────────────────────
    await setAgentStep(task.id, "branching", "create_branch");
    if (controller.signal.aborted) throw new Error("aborted");
    await setAsideOldBranch(task.id, project, branch);
    const branchResult = await createBranch(project.repoPath, branch);
    if (branchResult.code !== 0) {
      throw new Error(`git checkout -b failed:\n${branchResult.stderr}`);
    }
    createdBranch = true;
    {
      const t = await updateTask(task.id, { branch });
      broadcastTaskUpdated(t);
    }

    // Acceptance criteria are needed by the PR body building below.
    const acceptanceCriteria = extractAcceptanceCriteria(task.analysis);

    // ── Step 3: team run ──────────────────────────────────────────────────
    await setAgentStep(task.id, "running", "team");
    const outcome = await runTeam({ task, project, controller });

    if (outcome.kind === "awaiting_approval") {
      await returnToBase(task.id, project, branch, { deleteBranch: true });
      const paused = await updateTask(task.id, {
        branch: null,
        agent: { status: "awaiting_approval", currentStep: "team:awaiting_approval" },
      });
      broadcastStatus(task.id, "awaiting_approval", "team:awaiting_approval");
      broadcastTaskUpdated(paused);
      return;
    }

    if (outcome.kind === "stuck") {
      await stopStuck(task, project, branch, outcome.reason, outcome.reasonText, outcome.summary);
      return;
    }

    postComment(task.id, outcome.summary, "team summary");

    if (outcome.kind === "explored") {
      await returnToBase(task.id, project, branch, { deleteBranch: true });
      const final = await updateTask(task.id, {
        status: "done",
        branch: null,
        agent: { status: "done", currentStep: "completed", finishedAt: new Date().toISOString() },
      });
      broadcastStatus(task.id, "done", "completed");
      broadcastTaskUpdated(final);
      return;
    }

    const teamPrSection = buildPrTeamSection(outcome);

    // ── Step 4: git add . && commit ───────────────────────────────────────
    await setAgentStep(task.id, "pushing", "git_commit");
    await pushBlock(task.id, ["", "▸ git add -A && git commit"]);
    const commitMsg = task.displayId
      ? `feat(${task.displayId}): ${task.title}`
      : `feat: ${task.title} implemented by agent`;
    const commitResult = await commitAll(project.repoPath, commitMsg);
    await pushCmdResult(task.id, commitResult);
    const nothingToCommit =
      commitResult.code !== 0 &&
      /nothing to commit/i.test(commitResult.stdout + commitResult.stderr);
    if (commitResult.code !== 0 && !nothingToCommit) {
      throw new Error(`git commit failed:\n${commitResult.stderr}`);
    }

    // How many commits is this branch ahead of base? Claude may have committed
    // internally via Bash, or the task may have been a true no-op.
    const aheadResult = await gitRun(
      "git",
      ["rev-list", "--count", `${project.defaultBranch}..HEAD`],
      project.repoPath,
    );
    const commitsAhead = Number.parseInt(aheadResult.stdout.trim(), 10) || 0;

    if (nothingToCommit && commitsAhead === 0) {
      await pushBlock(task.id, [
        "",
        "ℹ Hiçbir değişiklik yok ve branch base'in ilerisinde değil.",
        "  Değişiklik gerekmiyordu → görev 'done' olarak kapatıldı, dal silindi.",
      ]);
      await returnToBase(task.id, project, branch, { deleteBranch: true });
      postComment(
        task.id,
        "Değişiklik gerekmedi: ekip çalıştı ama repoda değiştirilecek bir şey bulmadı. Görev kapatıldı, dal silindi.",
        "no changes",
      );
      const final = await updateTask(task.id, {
        status: "done",
        branch: null,
        agent: {
          status: "done",
          currentStep: "completed",
          finishedAt: new Date().toISOString(),
        },
      });
      broadcastStatus(task.id, "done", "completed");
      broadcastTaskUpdated(final);
      return;
    }

    // ── Step 5: push (skip if no remote) ─────────────────────────────────
    const remotes = await gitRun("git", ["remote"], project.repoPath);
    const hasRemote = remotes.stdout.trim() !== "";

    let prUrl: string | null = null;
    let prNumber: number | null = null;

    if (hasRemote) {
      await setAgentStep(task.id, "pushing", "git_push");
      await pushBlock(task.id, ["", `▸ git push -u origin ${branch}`]);
      const pushResult = await pushBranch(project.repoPath, branch);
      await pushCmdResult(task.id, pushResult);
      if (pushResult.code !== 0) {
        throw new Error(`git push failed:\n${pushResult.stderr}`);
      }

      // ── Step 6: open PR ─────────────────────────────────────────────────
      await setAgentStep(task.id, "pr_opening", "gh_pr_create");
      await pushBlock(task.id, ["", "▸ gh pr create"]);

      const refreshed = await getTask(task.id);
      const recentLog = (refreshed?.agent.log ?? []).slice(-30).join("\n");

      const prBodyParts: string[] = [];
      if (task.description) prBodyParts.push(`## Açıklama\n${task.description}`);
      if (task.analysis) prBodyParts.push(`## Analiz\n${task.analysis}`);
      if (teamPrSection) prBodyParts.push(teamPrSection);
      prBodyParts.push(
        `## Nasıl Test Edilir\n` +
          (acceptanceCriteria
            ? `Acceptance kriterleri (her biri test edilebilir):\n\n${acceptanceCriteria}\n\n` +
              `Hızlı doğrulama:\n` +
              `- Repo'nun test komutunu çalıştır (\`npm test\` / \`pytest\` / \`go test ./...\` — package.json/pyproject/go.mod'a göre).\n` +
              `- Branch'i lokal'e çekip dev sunucusunu açarak davranışı UI/CLI üzerinden kontrol et.`
            : `- Repo'nun test komutunu çalıştır (\`npm test\` / \`pytest\` / \`go test ./...\`).\n` +
              `- Branch'i lokal'e çekip ilgili akışı manuel deneyle.`),
      );
      prBodyParts.push(
        `## Agent Logu (son 30 satır)\n\`\`\`\n${recentLog}\n\`\`\``,
      );

      const prTitle = task.displayId
        ? `${task.displayId} — ${task.title}`
        : task.title;
      const prResult = await createPr({
        repoPath: project.repoPath,
        title: prTitle,
        body: prBodyParts.join("\n\n"),
        base: project.defaultBranch,
      });
      await pushCmdResult(task.id, prResult.raw);
      prUrl = prResult.url;
      prNumber = prResult.number;

      if (!prUrl) {
        throw new Error(
          `gh pr create failed:\n${prResult.raw.stderr.slice(0, 500)}`,
        );
      }

      await pushBlock(task.id, ["", `✓ PR opened: ${prUrl}`]);
    }

    // ── Done ──────────────────────────────────────────────────────────────
    // The task branch stays; the repo returns to base so UI commits never land on it.
    await returnToBase(task.id, project, branch, { deleteBranch: false });
    // Remote varsa (PR açıldı) review'a, yoksa done'a. Remote'suz review F4'te gelir.
    const finalStatus = hasRemote ? "review" : "done";
    const final = await updateTask(task.id, {
      status: finalStatus,
      prUrl,
      prNumber,
      agent: {
        status: "done",
        currentStep: "completed",
        finishedAt: new Date().toISOString(),
      },
    });
    broadcastStatus(task.id, "done", "completed");
    broadcastTaskUpdated(final);
  } catch (err) {
    const queued = err instanceof QueuedAbort;
    const aborted = controller.signal.aborted;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const code = aborted ? "aborted_by_user" : baseMessage;
    console.error(`[executor] task ${ref} (${task.id}) failed:`, aborted ? `aborted (${baseMessage})` : baseMessage);

    // A1b: only clean up a branch this run created, while it still holds the
    // repo lock. An error before that (queued abort, checkout failure) leaves
    // git alone so it never touches another run's working tree.
    if (createdBranch) {
      try {
        await gitRun("git", ["reset", "--hard", "HEAD"], project.repoPath);
        await gitRun("git", ["clean", "-fd"], project.repoPath);
        const co = await gitRun("git", ["checkout", project.defaultBranch], project.repoPath);
        if (co.code === 0) {
          await gitRun("git", ["branch", "-D", branch], project.repoPath);
          await pushLog(task.id, `↺ Cleaned up: returned to ${project.defaultBranch}, dropped ${branch}`);
        }
      } catch (cleanupErr) {
        console.warn(`[executor] post-error cleanup failed for ${ref}:`, cleanupErr);
      }
    }

    if (aborted) await pushLog(task.id, queued ? "✖ Aborted while queued" : "✖ Aborted by user");

    // A retry already enqueued a newer run for this task: leave its state alone.
    if (isLatest()) {
      const errTask = await updateTask(task.id, {
        status: "todo",
        agent: {
          status: "error",
          currentStep: undefined,
          error: code,
          finishedAt: new Date().toISOString(),
        },
      });
      broadcastStatus(task.id, "error");
      broadcastTaskUpdated(errTask);
    }
  } finally {
    lease?.release();
    if (holds(PENDING, task.id, token)) PENDING.delete(task.id);
    if (holds(RUNNING, task.id, token)) RUNNING.delete(task.id);
    if (isLatest()) LATEST.delete(task.id);
  }
}
