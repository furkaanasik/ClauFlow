import { run as gitRun, commitAll, ensureGhCredentials, pushBranch } from "../services/gitService.js";
import { acquireRepoLock } from "../services/repoLock.js";
import { runRole } from "./roleRunner.js";
import {
  buildCommentPrompt,
  buildCommentSystemMarker,
  buildRoleSystemPrompt,
  loadRoleSkills,
} from "./teamPrompts.js";
import { getTask, getTaskEffectiveBudget, listNodeRunsByTask } from "../services/taskService.js";
import { resolveTeamForTask } from "../services/teamService.js";
import { listTeamArtifactsByTask } from "../services/teamRunService.js";
import { defaultRole } from "../services/teamTemplates.js";
import {
  appendCommentLog,
  getComment,
  updateComment,
} from "../services/commentService.js";
import { broadcastCommentUpdated, broadcastStashCreated } from "../services/wsService.js";
import type { Comment } from "../services/commentService.js";
import type { Project, TeamArtifactKind } from "../types/index.js";
import type { UiLang } from "./uiText.js";

class CommentRunError extends Error {}

type CommentProject = Pick<Project, "id" | "name" | "repoPath" | "defaultBranch" | "defaultTeamId" | "aiPrompt">;

interface RunCommentOptions {
  /** GUI language for the role's reply (`POST /comments` body; default en). */
  uiLang?: UiLang;
}

/** 1-based comment round of the task: earlier `role:comment:<n>` node runs + 1. */
function commentRound(taskId: string): number {
  return listNodeRunsByTask(taskId).filter((r) => r.nodeId.startsWith("role:comment:")).length + 1;
}

/**
 * Applies a comment on the task's branch. Waits (FIFO) for the repo lock so
 * it never switches branches under a running executor, and always leaves the
 * repo on the base branch: leftover edits go to a `clauflow-comment-<id>` stash.
 */
export async function runComment(
  comment: Comment,
  project: CommentProject,
  opts: RunCommentOptions = {},
): Promise<void> {
  const lease = await acquireRepoLock(project.repoPath, { owner: `comment:${comment.id}` });
  try {
    await runCommentInner(comment, project, opts);
  } finally {
    lease.release();
  }
}

async function returnToBase(
  comment: Comment,
  project: Pick<Project, "id" | "repoPath" | "defaultBranch">,
): Promise<void> {
  const repo = project.repoPath;
  try {
    const dirty = await gitRun("git", ["status", "--porcelain"], repo);
    if (dirty.code === 0 && dirty.stdout.trim()) {
      const label = `clauflow-comment-${comment.id}`;
      const stash = await gitRun("git", ["stash", "push", "-u", "-m", label], repo);
      if (stash.code === 0) {
        appendCommentLog(comment.id, `↺ Uncommitted changes stashed as ${label}`);
        const task = await getTask(comment.taskId).catch(() => null);
        broadcastStashCreated(comment.taskId, {
          projectId: project.id,
          label,
          reason: "comment",
          displayId: task?.displayId ?? null,
        });
      }
    }
    const co = await gitRun("git", ["checkout", project.defaultBranch], repo);
    if (co.code !== 0) {
      appendCommentLog(comment.id, `[warn] git checkout ${project.defaultBranch} failed: ${co.stderr.trim()}`);
    }
  } catch (e) {
    console.warn(`[commentRunner] return to base failed for ${comment.id}:`, e);
  }
}

async function runCommentInner(
  comment: Comment,
  project: CommentProject,
  opts: RunCommentOptions,
): Promise<void> {
  const projectRepoPath = project.repoPath;
  let checkedOut = false;
  try {
    // ── Step 1: load task + branch (under the repo lock) ──────────────────
    const task = await getTask(comment.taskId);
    if (!task) {
      throw new Error(`Task not found: ${comment.taskId}`);
    }
    if (task.status === "doing") throw new CommentRunError("task_running");
    const ref = task.displayId ?? task.id;
    const branch = task.branch;
    if (!branch) throw new CommentRunError("no_branch");

    // ── Step 2: mark running ──────────────────────────────────────────────
    const running = updateComment(comment.id, { status: "running" });
    broadcastCommentUpdated(running);
    appendCommentLog(comment.id, `▸ Feature: ${ref} (branch ${branch})`);
    {
      const fresh = getComment(comment.id);
      if (fresh) broadcastCommentUpdated(fresh);
    }

    // ── Step 3: refresh git credentials (same as executor; E1: only with a
    // remote, a missing gh fails as `gh_missing` before the checkout) ──────
    await ensureGhCredentials(projectRepoPath);

    // ── Step 4: git checkout <branch> ─────────────────────────────────────
    if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
      throw new Error(`Invalid branch name: ${branch}`);
    }
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
    checkedOut = true;

    // ── Step 5: the developer role's next round (E7b, plan §3/30) ────────
    // Same isolation, tools, model, skills and budget as a team developer
    // round; runRole records the node run, tool calls, text, usage and cost.
    const team = resolveTeamForTask(task, project);
    const role = team.roles.find((r) => r.kind === "developer") ?? defaultRole("developer");
    const n = commentRound(task.id);
    const log = (line: string): void => {
      appendCommentLog(comment.id, line);
      const fresh = getComment(comment.id);
      if (fresh) broadcastCommentUpdated(fresh);
    };
    log(`▸ Rol: ${role.name} (${team.name}, yorum turu ${n}, model ${role.model})`);

    const { skills, missing } = await loadRoleSkills(role.skills, projectRepoPath);
    const system = buildRoleSystemPrompt(role, n, skills, { marker: buildCommentSystemMarker(n) });
    if (system.skills.injected.length > 0) log(`⚡ Skills injected: ${system.skills.injected.join(", ")}`);
    if (missing.length > 0) log(`[warn] Skill bulunamadı: ${missing.join(", ")}`);
    if (system.skills.skipped.length > 0) {
      log(`[warn] Skill tavanı (60k) doldu, atlandı: ${system.skills.skipped.join(", ")}`);
    }

    const artifacts = listTeamArtifactsByTask(task.id);
    const lastOf = (kind: TeamArtifactKind) => [...artifacts].reverse().find((a) => a.kind === kind);
    const qa = lastOf("qa_report");
    const prompt = buildCommentPrompt(role, {
      task,
      project,
      spec: lastOf("spec")?.body ?? null,
      qaReport: qa ? { verdict: qa.verdict, body: qa.body } : null,
      comment: comment.body,
      uiLang: opts.uiLang,
    });

    const out = await runRole({
      taskId: task.id,
      cwd: projectRepoPath,
      signal: new AbortController().signal,
      nodeId: `role:comment:${n}`,
      nodeType: "developer",
      prompt,
      appendSystemPrompt: system.text,
      model: role.model,
      advisorModel: role.advisorModel,
      tools: role.tools,
      isolate: true,
      budgetUsd: getTaskEffectiveBudget(task.id),
      // A comment is its own round: only its own spend counts against the budget.
      spentBeforeUsd: 0,
      budgetContext: {
        taskTitle: task.title,
        displayId: task.displayId ?? null,
        projectId: project.id,
        projectName: project.name,
      },
      inputArtifact: { roleId: role.id, round: n, team: team.name, commentId: comment.id },
      onLogLine: log,
    });
    if (out.budgetExceeded) throw new CommentRunError("stuck_budget");

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
    await returnToBase(comment, project);
    checkedOut = false;
    const done = updateComment(comment.id, { status: "done" });
    broadcastCommentUpdated(done);
  } catch (err) {
    if (checkedOut) await returnToBase(comment, project);
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
