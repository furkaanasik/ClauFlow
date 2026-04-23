import { run as gitRun, commitAll, pushBranch } from "../services/gitService.js";
import { runClaude } from "../services/claudeService.js";
import { getTask } from "../services/taskService.js";
import {
  appendCommentLog,
  getComment,
  updateComment,
} from "../services/commentService.js";
import { broadcastCommentUpdated } from "../services/wsService.js";
import type { Comment } from "../services/commentService.js";

export async function runComment(
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
    const branch = task.branch;
    if (!branch) {
      throw new Error("Task has no branch — cannot apply comment");
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

    const claudeResult = await runClaude({
      prompt,
      cwd: projectRepoPath,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      onLine: async (line, stream) => {
        const entry = stream === "stderr" ? `[stderr] ${line}` : line;
        appendCommentLog(comment.id, entry);
        const fresh = getComment(comment.id);
        if (fresh) broadcastCommentUpdated(fresh);
      },
    });

    if (claudeResult.code !== 0) {
      throw new Error(
        `claude CLI exited ${claudeResult.code}:\n` +
          claudeResult.stderr.slice(0, 500),
      );
    }

    // ── Step 6: commit ────────────────────────────────────────────────────
    const commitResult = await commitAll(
      projectRepoPath,
      "fix: user feedback applied",
    );
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
