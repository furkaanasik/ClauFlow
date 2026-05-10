import { runClaude } from "../services/claudeService.js";
import {
  appendCommentLog,
  createComment,
  getComment,
  updateComment,
} from "../services/commentService.js";
import { broadcastCommentUpdated } from "../services/wsService.js";
import type { Project, Task } from "../types/index.js";

const RUNNING = new Map<string, Promise<void>>();

export function enqueue(task: Task, project: Project): void {
  if (!task.prNumber) return;
  const previous = RUNNING.get(task.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => runInner(task, project));
  RUNNING.set(task.id, next);
  next.finally(() => {
    if (RUNNING.get(task.id) === next) RUNNING.delete(task.id);
  });
}

async function runInner(task: Task, project: Project): Promise<void> {
  const comment = createComment(task.id, "🔍 Auto-review in progress…");
  try {
    const running = updateComment(comment.id, { status: "running" });
    broadcastCommentUpdated(running);

    const prompt =
      `You are performing an automated code review for PR #${task.prNumber}.\n\n` +
      `Task: ${task.title}\n` +
      (task.description ? `Description: ${task.description}\n\n` : "\n") +
      `Run \`gh pr diff ${task.prNumber}\` to fetch the diff, then write a concise review.\n\n` +
      `Format your response as:\n` +
      `## Code Review\n\n` +
      `### Summary\n[what changed]\n\n` +
      `### Issues Found\n[bugs, security, correctness — with file:line refs; "None" if clean]\n\n` +
      `### Suggestions\n[style, perf, clarity improvements; "None" if clean]\n\n` +
      `### Verdict\n**LGTM** | **Needs Changes** | **Critical Issues**\n\n` +
      `Keep it concise. Focus on correctness over nitpicks.`;

    let reviewLines: string[] = [];
    const onLogLine = async (line: string, stream: "stdout" | "stderr"): Promise<void> => {
      if (stream === "stdout") reviewLines.push(line);
      const entry = stream === "stderr" ? `[stderr] ${line}` : line;
      appendCommentLog(comment.id, entry);
      const fresh = getComment(comment.id);
      if (fresh) broadcastCommentUpdated(fresh);
    };

    const claudeResult = await runClaude({
      prompt,
      cwd: project.repoPath,
      allowedTools: ["Bash"],
      onLine: onLogLine,
    });

    const reviewText = reviewLines.join("\n").trim();

    if (claudeResult.code !== 0 || !reviewText) {
      throw new Error(
        claudeResult.code !== 0
          ? `claude CLI exited ${claudeResult.code}: ${claudeResult.stderr.slice(0, 300)}`
          : "claude produced no review text",
      );
    }

    const done = updateComment(comment.id, { body: reviewText, status: "done" });
    broadcastCommentUpdated(done);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[prReviewRunner] task ${task.id} failed:`, message);
    try { appendCommentLog(comment.id, `[error] ${message}`); } catch {}
    try {
      const errored = updateComment(comment.id, { status: "error" });
      broadcastCommentUpdated(errored);
    } catch {}
  }
}
