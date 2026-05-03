import { run as gitRun, commitAll, pushBranch } from "./gitService.js";
import {
  parseChecksJson,
  fetchFailedLogs,
  buildFailureArtifact,
} from "./ciService.js";
import { runClaude } from "./claudeService.js";
import { appendAgentLog, getTask, updateTask } from "./taskService.js";
import {
  broadcastCiCheckStatus,
  broadcastCiIterationResult,
  broadcastCiIterationStarted,
  broadcastLog,
  broadcastTaskUpdated,
} from "./wsService.js";
import type { CiFailure, Project, Task } from "../types/index.js";

const CI_POLL_INTERVAL_MS = Number(process.env.CI_POLL_INTERVAL_MS ?? 30_000);
const CI_MAX_FIX_ITERATIONS = Number(process.env.CI_MAX_FIX_ITERATIONS ?? 3);

interface WatchState {
  timer: ReturnType<typeof setTimeout> | null;
  iteration: number;
  stopped: boolean;
  branch: string | null;
}

const WATCHERS = new Map<string, WatchState>();

export function stopCiWatch(taskId: string): void {
  const state = WATCHERS.get(taskId);
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  WATCHERS.delete(taskId);
}

export function startCiWatch(task: Task, project: Project): void {
  stopCiWatch(task.id);
  const state: WatchState = {
    timer: null,
    iteration: 0,
    stopped: false,
    branch: task.branch ?? null,
  };
  WATCHERS.set(task.id, state);
  schedulePoll(task.id, task.prNumber!, project, state);
}

function schedulePoll(
  taskId: string,
  prNumber: number,
  project: Project,
  state: WatchState,
): void {
  if (state.stopped) return;
  state.timer = setTimeout(() => {
    poll(taskId, prNumber, project, state).catch((err) => {
      console.error(`[ciWatcher] poll error for task ${taskId}:`, err);
    });
  }, CI_POLL_INTERVAL_MS);
}

async function pushWatchLog(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}

async function poll(
  taskId: string,
  prNumber: number,
  project: Project,
  state: WatchState,
): Promise<void> {
  if (state.stopped) return;

  const currentTask = await getTask(taskId);
  if (!currentTask || currentTask.status !== "ci") {
    WATCHERS.delete(taskId);
    return;
  }

  await pushWatchLog(taskId, `[ci] Polling checks for PR #${prNumber}…`);

  const checksResult = await gitRun(
    "gh",
    ["pr", "checks", String(prNumber), "--json", "name,bucket,link"],
    project.repoPath,
  );

  const verdict = parseChecksJson(checksResult.stdout);
  broadcastCiCheckStatus(taskId, prNumber, verdict);

  if (verdict.kind === "pending") {
    await pushWatchLog(taskId, `[ci] verdict=pending — will retry`);
    schedulePoll(taskId, prNumber, project, state);
    return;
  }

  if (verdict.kind === "pass" || verdict.kind === "no_checks") {
    const msg = verdict.kind === "no_checks"
      ? "[ci] No checks configured — skipping CI gate ✓"
      : "[ci] All checks passed ✓";
    await pushWatchLog(taskId, msg);
    broadcastCiIterationResult(taskId, state.iteration, "pass");
    await moveToReview(taskId);
    WATCHERS.delete(taskId);
    return;
  }

  // verdict.kind === "fail" | "timeout"
  const failures: CiFailure[] = verdict.kind === "fail" ? verdict.failures : [];
  await pushWatchLog(
    taskId,
    `[ci] ${failures.length} check(s) failed (iteration ${state.iteration}/${CI_MAX_FIX_ITERATIONS})`,
  );

  if (state.iteration >= CI_MAX_FIX_ITERATIONS) {
    await pushWatchLog(
      taskId,
      `[ci] Max fix iterations (${CI_MAX_FIX_ITERATIONS}) reached — moving to review`,
    );
    broadcastCiIterationResult(taskId, state.iteration, "exhausted");
    await moveToReview(taskId);
    WATCHERS.delete(taskId);
    return;
  }

  broadcastCiIterationResult(taskId, state.iteration, "fail");
  state.iteration += 1;
  broadcastCiIterationStarted(taskId, state.iteration, CI_MAX_FIX_ITERATIONS);
  await pushWatchLog(
    taskId,
    `[ci] Starting fix iteration ${state.iteration}/${CI_MAX_FIX_ITERATIONS}`,
  );

  await runFixIteration(taskId, prNumber, project, state, failures);

  if (!state.stopped) {
    schedulePoll(taskId, prNumber, project, state);
  }
}

async function runFixIteration(
  taskId: string,
  prNumber: number,
  project: Project,
  state: WatchState,
  failures: CiFailure[],
): Promise<void> {
  try {
    const logsByRunId = await fetchFailedLogs(project.repoPath, failures);
    const artifact = buildFailureArtifact(prNumber, state.iteration, failures, logsByRunId);

    const failureSummary = artifact.failures
      .map((f) => {
        const parts = [`Job: ${f.jobName}`, `Conclusion: ${f.conclusion}`];
        if (f.link) parts.push(`Link: ${f.link}`);
        if (f.logTail) parts.push(`Log tail:\n${f.logTail}`);
        return parts.join("\n");
      })
      .join("\n\n---\n\n");

    const prompt =
      `CI checks failed for PR #${prNumber}. Fix the failing tests/checks.\n\n` +
      `Failed jobs:\n\n${failureSummary}\n\n` +
      `Fix the root cause. Do not weaken tests — fix the implementation. ` +
      `When done, exit the terminal.`;

    const claudeResult = await runClaude({
      prompt,
      cwd: project.repoPath,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      onLine: async (line, stream) => {
        const entry = stream === "stderr" ? `[stderr] ${line}` : line;
        await appendAgentLog(taskId, entry);
        broadcastLog(taskId, entry);
      },
    });

    if (claudeResult.code !== 0) {
      await pushWatchLog(
        taskId,
        `[ci] claude fix exited ${claudeResult.code} — will re-poll anyway`,
      );
      return;
    }

    const commitMsg = `fix(ci): iteration ${state.iteration} — fix failing checks`;
    const commitResult = await commitAll(project.repoPath, commitMsg);
    const nothingToCommit =
      commitResult.code !== 0 &&
      /nothing to commit/i.test(commitResult.stdout + commitResult.stderr);

    if (commitResult.code !== 0 && !nothingToCommit) {
      await pushWatchLog(
        taskId,
        `[ci] git commit failed — ${commitResult.stderr.slice(0, 200)}`,
      );
      return;
    }

    if (!nothingToCommit && state.branch) {
      const pushResult = await pushBranch(project.repoPath, state.branch);
      if (pushResult.code !== 0) {
        await pushWatchLog(
          taskId,
          `[ci] git push failed — ${pushResult.stderr.slice(0, 200)}`,
        );
      } else {
        await pushWatchLog(taskId, "[ci] Fix committed and pushed ✓");
      }
    } else if (nothingToCommit) {
      await pushWatchLog(taskId, "[ci] claude made no changes");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pushWatchLog(taskId, `[ci] fix iteration error: ${msg}`);
  }
}

async function moveToReview(taskId: string): Promise<void> {
  const updated = await updateTask(taskId, {
    status: "review",
    agent: {
      status: "done",
      currentStep: "ci_complete",
      finishedAt: new Date().toISOString(),
    },
  });
  broadcastTaskUpdated(updated);
}
