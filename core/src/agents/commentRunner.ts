import { run as gitRun, commitAll, pushBranch } from "../services/gitService.js";
import { parseUsageFromResult, runClaude } from "../services/claudeService.js";
import {
  getTask,
  insertAgentText,
  insertToolCall,
  updateTaskUsage,
  updateToolCall,
} from "../services/taskService.js";
import {
  appendCommentLog,
  getComment,
  updateComment,
} from "../services/commentService.js";
import {
  broadcastAgentText,
  broadcastCommentUpdated,
  broadcastTaskUpdated,
  broadcastToolCall,
} from "../services/wsService.js";
import type { Comment } from "../services/commentService.js";

const RUNNING = new Map<string, Promise<void>>();

export function runComment(
  comment: Comment,
  projectRepoPath: string,
): Promise<void> {
  const previous = RUNNING.get(comment.taskId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => runCommentInner(comment, projectRepoPath));
  RUNNING.set(comment.taskId, next);
  next.finally(() => {
    if (RUNNING.get(comment.taskId) === next) {
      RUNNING.delete(comment.taskId);
    }
  });
  return next;
}

async function runCommentInner(
  comment: Comment,
  projectRepoPath: string,
): Promise<void> {
  try {
    // ── Step 1: mark running ──────────────────────────────────────────────
    const running = updateComment(comment.id, { status: "running" });
    broadcastCommentUpdated(running);

    // ── Step 2: load task + branch ────────────────────────────────────────
    const task = await getTask(comment.taskId);
    if (!task) {
      throw new Error(`Task not found: ${comment.taskId}`);
    }
    const ref = task.displayId ?? task.id;
    const branch = task.branch;
    if (!branch) {
      throw new Error("Task has no branch — cannot apply comment");
    }
    appendCommentLog(comment.id, `▸ Feature: ${ref} (branch ${branch})`);
    {
      const fresh = getComment(comment.id);
      if (fresh) broadcastCommentUpdated(fresh);
    }

    // ── Step 3: refresh git credentials (same as executor) ────────────────
    await gitRun("gh", ["auth", "setup-git"], projectRepoPath);

    // ── Step 4: git checkout <branch> ─────────────────────────────────────
    const coResult = await gitRun(
      "git",
      ["checkout", branch],
      projectRepoPath,
    );
    if (coResult.code !== 0) {
      throw new Error(
        `git checkout ${branch} failed:\n${coResult.stderr}`,
      );
    }

    // ── Step 5: run claude CLI with the comment as feedback ───────────────
    const prompt =
      `Kullanıcı şu geri bildirimi verdi: ${comment.body}\n\n` +
      `Gerekli düzeltmeleri yap.`;

    const onLogLine = async (
      line: string,
      stream: "stdout" | "stderr",
    ): Promise<void> => {
      const entry = stream === "stderr" ? `[stderr] ${line}` : line;
      appendCommentLog(comment.id, entry);
      const fresh = getComment(comment.id);
      if (fresh) broadcastCommentUpdated(fresh);
    };

    const onToolCallStart = (tc: {
      id: string;
      toolName: string;
      args: unknown;
      startedAt: string;
    }): void => {
      try {
        const stored = insertToolCall({
          id: tc.id,
          taskId: comment.taskId,
          toolName: tc.toolName,
          args: tc.args,
          status: "running",
          startedAt: tc.startedAt,
        });
        broadcastToolCall(stored);
      } catch (e) {
        console.error(
          `[commentRunner] insertToolCall failed for ${tc.id}:`,
          e,
        );
      }
    };

    const onToolCallEnd = (tc: {
      id: string;
      result: string | null;
      status: "running" | "done" | "error";
      finishedAt: string | null;
      durationMs: number | null;
    }): void => {
      try {
        const updated = updateToolCall(tc.id, {
          status: tc.status,
          result: tc.result,
          finishedAt: tc.finishedAt,
          durationMs: tc.durationMs,
        });
        if (updated) broadcastToolCall(updated);
      } catch (e) {
        console.error(
          `[commentRunner] updateToolCall failed for ${tc.id}:`,
          e,
        );
      }
    };

    // Comments live "underneath" their task — narrative text and usage are
    // attributed to the task itself so the timeline stays unified across
    // executor + comment runs.
    const onAgentText = (text: string): void => {
      if (!text || !text.trim()) return;
      try {
        const stored = insertAgentText({ taskId: comment.taskId, text });
        broadcastAgentText(stored);
      } catch (e) {
        console.error(`[commentRunner] insertAgentText failed:`, e);
      }
    };

    const onClaudeResult = (raw: unknown): void => {
      const usage = parseUsageFromResult(raw);
      if (!usage) return;
      updateTaskUsage(comment.taskId, usage)
        .then((t) => {
          if (t) broadcastTaskUpdated(t);
        })
        .catch((e) => {
          console.error(`[commentRunner] updateTaskUsage failed:`, e);
        });
    };

    let claudeResult = await runClaude({
      prompt,
      cwd: projectRepoPath,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      outputFormat: "stream-json",
      onLine: onLogLine,
      onText: onAgentText,
      onToolCallStart,
      onToolCallEnd,
      onResult: onClaudeResult,
    });

    if (claudeResult.code !== 0) {
      const errSnippet = (claudeResult.stderr || claudeResult.stdout).slice(0, 200);
      const looksLikeFormatError = /unknown.*output[- ]format|stream-json|--verbose/i.test(
        errSnippet,
      );
      if (looksLikeFormatError) {
        appendCommentLog(
          comment.id,
          "[fallback] stream-json mode failed; retrying with text output",
        );
        const fresh = getComment(comment.id);
        if (fresh) broadcastCommentUpdated(fresh);
        claudeResult = await runClaude({
          prompt,
          cwd: projectRepoPath,
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          onLine: onLogLine,
        });
      }
    }

    if (claudeResult.code !== 0) {
      throw new Error(
        `claude CLI exited ${claudeResult.code}:\n` +
          claudeResult.stderr.slice(0, 500),
      );
    }

    // ── Step 6: commit ────────────────────────────────────────────────────
    const commitMsg = task.displayId
      ? `fix(${task.displayId}): user feedback applied`
      : "fix: user feedback applied";
    const commitResult = await commitAll(projectRepoPath, commitMsg);
    if (commitResult.code !== 0) {
      if (commitResult.stdout.includes("nothing to commit")) {
        throw new Error(
          "claude produced no file changes — nothing to commit",
        );
      }
      throw new Error(`git commit failed:\n${commitResult.stderr}`);
    }

    // ── Step 7: push (only if remote exists) ──────────────────────────────
    const remotes = await gitRun("git", ["remote"], projectRepoPath);
    const hasRemote = remotes.stdout.trim() !== "";
    if (hasRemote) {
      const pushResult = await pushBranch(projectRepoPath, branch);
      if (pushResult.code !== 0) {
        throw new Error(`git push failed:\n${pushResult.stderr}`);
      }
    }

    // ── Done ──────────────────────────────────────────────────────────────
    const done = updateComment(comment.id, { status: "done" });
    broadcastCommentUpdated(done);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[commentRunner] comment ${comment.id} failed:`, message);
    try {
      appendCommentLog(comment.id, `[error] ${message}`);
    } catch {
      // ignore — best effort log
    }
    try {
      const errored = updateComment(comment.id, { status: "error" });
      broadcastCommentUpdated(errored);
    } catch {
      // ignore — broadcast is best effort
    }
  }
}
