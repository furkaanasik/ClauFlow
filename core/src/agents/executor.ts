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
  getTask,
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

export async function run(task: Task, project: Project): Promise<void> {
  const branch = `feature/issue-${task.id}`;
  const controller = new AbortController();
  RUNNING.set(task.id, controller);

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

    // ── Step 3: run claude CLI ────────────────────────────────────────────
    await setAgentStep(task.id, "running", "claude_cli");

    const taskBrief = task.analysis || task.description || task.title;
    const background = project.aiPrompt?.trim();
    const acceptanceCriteria = extractAcceptanceCriteria(task.analysis);
    const testingInstructions =
      `Testing requirements:\n` +
      `- Before coding, detect the repo's test runner: check package.json scripts ("test", "test:unit"), and config files (vitest.config.*, jest.config.*, pytest.ini, pyproject.toml with pytest, go.mod for go test).\n` +
      `- If a runner exists, write unit tests that cover each acceptance criterion as an assertion. Prefer testing observable behavior over implementation details.\n` +
      `- If NO test runner is configured and this looks like a greenfield repo, set up a minimal one matching the stack: vitest for TypeScript/JavaScript, pytest for Python, go test for Go. Add an "npm test" (or equivalent) script.\n` +
      `- Run the test command after writing tests. Do not finish until tests pass. If a test reveals a bug in your implementation, fix the implementation — do not weaken the test.\n` +
      `- Skip tests only for pure config/docs changes where behavior cannot be meaningfully asserted.`;

    const prompt = background
      ? `Project background (reference only — do NOT implement features beyond the current task's scope):\n` +
        `${background}\n\n` +
        `Current task — implement exactly what this describes, nothing more:\n\n` +
        `${taskBrief}\n\n` +
        `${testingInstructions}\n\n` +
        `When done, exit the terminal.`
      : `Aşağıdaki analize göre kodu yaz ve bitince terminalden çık:\n\n` +
        `${taskBrief}\n\n` +
        testingInstructions;

    await pushBlock(task.id, [
      "",
      "▸ Test guidance (agent'a verildi):",
      ...testingInstructions.split("\n").map((l) => `  ${l}`),
      ...(acceptanceCriteria
        ? [
            "",
            "▸ Acceptance criteria (test'lerle karşılanmalı):",
            ...acceptanceCriteria.split("\n").map((l) => `  ${l}`),
          ]
        : []),
      "",
      "▸ Running claude CLI…",
    ]);

    const claudeResult = await runClaude({
      prompt,
      cwd: project.repoPath,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      signal: controller.signal,
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
    await pushBlock(task.id, ["", "▸ git add -A && git commit"]);
    const commitMsg = `feat: ${task.title} implemented by agent`;
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
        "  Acceptance kriterleri zaten karşılanıyor → task otomatik olarak DONE'a alındı.",
      ]);
      const final = await updateTask(task.id, {
        status: "done",
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

      const prResult = await createPr({
        repoPath: project.repoPath,
        title: task.title,
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
    const aborted = controller.signal.aborted;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const message = aborted
      ? `Kullanıcı tarafından durduruldu${baseMessage ? ` (${baseMessage})` : ""}`
      : baseMessage;
    console.error(`[executor] task ${task.id} failed:`, message);
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
  } finally {
    RUNNING.delete(task.id);
  }
}
