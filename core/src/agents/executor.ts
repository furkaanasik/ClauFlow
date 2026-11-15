import {
  checkoutBase,
  createBranch,
  commitAll,
  pushBranch,
  createPr,
  run as gitRun,
} from "../services/gitService.js";
import { buildPrTeamSection, runTeam } from "./teamRunner.js";
import {
  appendAgentLog,
  getTask,
  listTasks,
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
import { startCiWatch } from "../services/ciWatcher.js";
import { enqueue as enqueueReview } from "./prReviewRunner.js";
import type { AgentStatus, Project, Task } from "../types/index.js";

const ACTIVE: AgentStatus[] = ["branching", "running", "pushing", "pr_opening"];

// Polls until no other task in this project is actively running in this process.
// Uses the in-memory RUNNING map — resets on server restart (orphaned tasks are
// recovered separately by recoverOrphanedTasks on boot).
async function acquireSlot(projectId: string, taskId: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const tasks = await listTasks(projectId);
    const busy = tasks.some(
      (t) => t.id !== taskId && t.status === "doing" && RUNNING.has(t.id),
    );
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(
    `[executor] acquireSlot timed out for task ${taskId} in project ${projectId} after 240s`,
  );
  throw new Error("Slot acquisition timed out after 240s");
}

const RUNNING = new Map<string, AbortController>();

export function abort(taskId: string): boolean {
  const ctrl = RUNNING.get(taskId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export function isRunning(taskId: string): boolean {
  return RUNNING.has(taskId);
}

/**
 * Resolves once the executor for `taskId` is no longer in the RUNNING map,
 * or after `timeoutMs` (whichever comes first). Lets `/retry` wait for an
 * abort to fully unwind before re-enqueuing.
 */
export async function waitForIdle(taskId: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (RUNNING.has(taskId)) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 100));
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
  const message = `Takıldı: ${reasonText}`;
  const errTask = await updateTask(task.id, {
    status: "todo",
    agent: {
      status: "error",
      currentStep: undefined,
      error: message,
      finishedAt: new Date().toISOString(),
    },
  });
  broadcastStatus(task.id, "error");
  broadcastTaskUpdated(errTask);
}

export async function run(task: Task, project: Project): Promise<void> {
  const controller = new AbortController();
  RUNNING.set(task.id, controller);

  const branch = buildBranchName(task);
  const ref = taskRef(task);

  try {
    // Wait until no other executor is active for this project (DB-level, survives restarts)
    await acquireSlot(project.id, task.id);

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
    // Delete any stale local branch from a previous failed run so retries
    // don't trip over "branch already exists".
    await gitRun("git", ["branch", "-D", branch], project.repoPath);
    const branchResult = await createBranch(project.repoPath, branch);
    if (branchResult.code !== 0) {
      throw new Error(`git checkout -b failed:\n${branchResult.stderr}`);
    }
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
      await stopStuck(task, project, branch, outcome.reasonText, outcome.summary);
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

    if (outcome.allText.includes("## Code Review Report")) {
      postComment(task.id, outcome.allText, "code review report");
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
        "  Değişiklik gerekmiyordu → task 'nothing' olarak işaretlendi.",
      ]);
      await returnToBase(task.id, project, branch, { deleteBranch: false });
      const final = await updateTask(task.id, {
        status: "nothing",
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
    // Remote yoksa done'a, PR varsa CI gate'e, remote-only ise review'a taşı
    const finalStatus = hasRemote && prNumber ? "ci" : hasRemote ? "review" : "done";
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

    if (finalStatus === "ci") {
      startCiWatch(final, project);
    }
    if (finalStatus === "review") {
      enqueueReview(final, project);
    }
  } catch (err) {
    const aborted = controller.signal.aborted;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const message = aborted
      ? `Kullanıcı tarafından durduruldu${baseMessage ? ` (${baseMessage})` : ""}`
      : baseMessage;
    console.error(`[executor] task ${ref} (${task.id}) failed:`, message);
    if (aborted) await pushLog(task.id, "✖ Aborted by user");

    // Roll back task status to "todo" so user can retry
    const errTask = await updateTask(task.id, {
      status: "todo",
      agent: {
        status: "error",
        currentStep: undefined,
        error: message,
        finishedAt: new Date().toISOString(),
      },
    });
    broadcastStatus(task.id, "error");
    broadcastTaskUpdated(errTask);

    // Cleanup: discard claude's uncommitted edits, return to base branch,
    // delete the failed feature branch. Best-effort — git failures must not
    // mask the original task error. Skip silently if the branch never existed
    // (e.g. error happened before createBranch).
    try {
      await gitRun("git", ["reset", "--hard", "HEAD"], project.repoPath);
      await gitRun("git", ["clean", "-fd"], project.repoPath);
      const co = await gitRun(
        "git",
        ["checkout", project.defaultBranch],
        project.repoPath,
      );
      if (co.code === 0) {
        await gitRun("git", ["branch", "-D", branch], project.repoPath);
        await pushLog(
          task.id,
          `↺ Cleaned up: returned to ${project.defaultBranch}, dropped ${branch}`,
        );
      }
    } catch (cleanupErr) {
      console.warn(
        `[executor] post-error cleanup failed for ${ref}:`,
        cleanupErr,
      );
    }
  } finally {
    RUNNING.delete(task.id);
  }
}
