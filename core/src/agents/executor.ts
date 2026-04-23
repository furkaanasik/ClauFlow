import {
  checkoutBase,
  createBranch,
  commitAll,
  pushBranch,
  createPr,
  run as gitRun,
} from "../services/gitService.js";
import { runClaude } from "../services/claudeService.js";
import {
  appendAgentLog,
  getProject,
  listTasks,
  updateTask,
} from "../services/taskService.js";
import {
  broadcastLog,
  broadcastStatus,
  broadcastTaskUpdated,
} from "../services/wsService.js";
import type { AgentStatus, Project, Task } from "../types/index.js";

const ACTIVE: AgentStatus[] = ["branching", "running", "pushing", "pr_opening"];

// Polls DB until no other task in this project has an active executor.
// Survives server restarts and hot-reloads unlike an in-memory queue.
async function acquireSlot(projectId: string, taskId: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const tasks = await listTasks(projectId);
    const busy = tasks.some(
      (t) => t.id !== taskId && t.status === "doing" && ACTIVE.includes(t.agent.status),
    );
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 2000));
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

export async function run(task: Task, project: Project): Promise<void> {
  const branch = `feature/issue-${task.id}`;

  // Wait until no other executor is active for this project (DB-level, survives restarts)
  await acquireSlot(project.id, task.id);

  // Stamp start time
  await updateTask(task.id, {
    agent: {
      status: "branching",
      currentStep: "start",
      log: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
  });

  try {
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

    // ── Step 3: run claude CLI ────────────────────────────────────────────
    await setAgentStep(task.id, "running", "claude_cli");

    const prompt =
      `Aşağıdaki analize göre kodu yaz ve bitince terminalden çık:\n\n` +
      (task.analysis || task.description || task.title);

    const claudeResult = await runClaude({
      prompt,
      cwd: project.repoPath,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      onLine: async (line, stream) => {
        const entry = stream === "stderr" ? `[stderr] ${line}` : line;
        await appendAgentLog(task.id, entry);
        broadcastLog(task.id, entry);
      },
    });

    if (claudeResult.code !== 0) {
      throw new Error(
        `claude CLI exited ${claudeResult.code}:\n` +
          claudeResult.stderr.slice(0, 500),
      );
    }

    // ── Step 4: git add . && commit ───────────────────────────────────────
    await setAgentStep(task.id, "pushing", "git_commit");
    const commitMsg = `feat: ${task.title} implemented by agent`;
    const commitResult = await commitAll(project.repoPath, commitMsg);
    if (commitResult.code !== 0) {
      // Claude produced no changes — there's nothing to push or review.
      if (commitResult.stdout.includes("nothing to commit")) {
        throw new Error(
          "claude produced no file changes — nothing to commit",
        );
      }
      throw new Error(`git commit failed:\n${commitResult.stderr}`);
    }

    // ── Step 5: push (skip if no remote) ─────────────────────────────────
    const remotes = await gitRun("git", ["remote"], project.repoPath);
    const hasRemote = remotes.stdout.trim() !== "";

    let prUrl: string | null = null;
    let prNumber: number | null = null;

    if (hasRemote) {
      await setAgentStep(task.id, "pushing", "git_push");
      const pushResult = await pushBranch(project.repoPath, branch);
      if (pushResult.code !== 0) {
        throw new Error(`git push failed:\n${pushResult.stderr}`);
      }

      // ── Step 6: open PR ─────────────────────────────────────────────────
      await setAgentStep(task.id, "pr_opening", "gh_pr_create");
      const prResult = await createPr({
        repoPath: project.repoPath,
        title: task.title,
        body: [
          task.description ? `## Açıklama\n${task.description}` : "",
          task.analysis ? `## Analiz\n${task.analysis}` : "",
          `## Agent Logu (son 20 satır)\n\`\`\`\n${task.agent.log.slice(-20).join("\n")}\n\`\`\``,
        ]
          .filter(Boolean)
          .join("\n\n"),
        base: project.defaultBranch,
      });
      prUrl = prResult.url;
      prNumber = prResult.number;

      if (!prUrl) {
        throw new Error(
          `gh pr create failed:\n${prResult.raw.stderr.slice(0, 500)}`,
        );
      }
    }

    // ── Done ──────────────────────────────────────────────────────────────
    // Remote yoksa review'a değil done'a taşı (local-only repo)
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
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[executor] task ${task.id} failed:`, message);

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
  }
}
