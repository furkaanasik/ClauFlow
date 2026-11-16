import fs from "node:fs";
import {
  addTaskCost,
  getTask,
  getTaskSync,
  getProject,
  createTask,
  updateTask,
} from "../services/taskService.js";
import {
  extractJsonArray,
  normalizeTasks,
  PLANNED_DEPENDENCY_FIELDS,
  runPlannerCli,
} from "./plannerShared.js";
import {
  broadcastTaskCreated,
  broadcastTaskUpdated,
  broadcastTaskBreakdownStarted,
  broadcastTaskBreakdownDone,
  broadcastTaskBreakdownError,
  broadcastCommentUpdated,
} from "../services/wsService.js";
import { createComment, updateComment } from "../services/commentService.js";
import { addEdgesInternal, listDependencies, listDependents } from "../services/dependencyService.js";
import { uiText, type UiLang } from "./uiText.js";

/**
 * After a breakdown the parent is closed as `done` with a comment naming the
 * subtask count. A parent that is running (`doing`) keeps its status: the
 * executor owns it until the run ends.
 */
export async function closeBrokenDownParent(
  taskId: string,
  count: number,
  uiLang?: UiLang,
): Promise<void> {
  const parent = await getTask(taskId);
  if (!parent || count === 0) return;
  try {
    const comment = createComment(taskId, uiText(uiLang).brokenDown(count));
    broadcastCommentUpdated(updateComment(comment.id, { status: "done" }));
  } catch (e) {
    console.error(`[taskBreakdown] breakdown comment for ${taskId} failed:`, e);
  }
  // E3: the parent may have moved to review while the breakdown ran; a review
  // task is closed only by its merge.
  if (parent.status === "done" || parent.status === "doing" || parent.status === "review") return;
  const closed = await updateTask(taskId, { status: "done" });
  broadcastTaskUpdated(closed);
}

/**
 * zincir F3 (§3/7): every not-yet-started dependent of the broken-down parent
 * (`todo`, or waiting in `doing/waiting_deps`) gets an edge to each subtask.
 * Uses the lock-free internal helper: a waiting dependent is linked too.
 */
export function linkParentDependents(parentId: string, subtaskIds: string[]): string[] {
  if (subtaskIds.length === 0) return [];
  const linked: string[] = [];
  const edges: Array<[string, string]> = [];
  for (const depId of listDependents(parentId)) {
    const dep = getTaskSync(depId);
    if (!dep) continue;
    const notStarted =
      dep.status === "todo" || (dep.status === "doing" && dep.agent.status === "waiting_deps");
    if (!notStarted) continue;
    linked.push(depId);
    for (const sub of subtaskIds) edges.push([depId, sub]);
  }
  if (edges.length === 0) return [];
  addEdgesInternal(edges);
  for (const id of linked) {
    const fresh = getTaskSync(id);
    if (fresh) broadcastTaskUpdated(fresh);
  }
  return linked;
}

/** Breakdown prompt (zincir F3: subtasks may chain like planner tasks, §5.5). */
export function buildBreakdownPrompt(opts: { prompt: string; cap: number }): string {
  const { prompt, cap } = opts;
  return (
    `You are a task planner. Break the following task description into at most ${cap} ` +
    `small, actionable subtasks.\n\nTask:\n${prompt}\n\n` +
    `Return ONLY a JSON array, no other text. Each item must be an object with these fields:\n` +
    `  - "title": string, max 80 chars, imperative ("Add login endpoint")\n` +
    `  - "description": ONE short sentence (max ~160 chars) summarizing the subtask\n` +
    `  - "analysis": markdown technical brief, KEEP UNDER ~180 WORDS to fit response budget\n` +
    `  - "priority": one of "low" | "medium" | "high" | "critical" (default "medium")\n` +
    `  - "tags": optional array of 1-4 short lowercase strings\n` +
    PLANNED_DEPENDENCY_FIELDS +
    `\n` +
    `Order tasks in execution sequence: if subtask B depends on subtask A, A must appear before B ` +
    `and B's "dependsOn" must list A's "key". Output strictly valid JSON — no commentary, no code fences.`
  );
}

export async function runTaskBreakdown(
  taskId: string,
  prompt: string,
  maxTasks: number = 6,
  uiLang?: UiLang,
): Promise<void> {
  const cap = Math.max(1, Math.min(Math.floor(maxTasks) || 6, 20));
  try {
    broadcastTaskBreakdownStarted(taskId);
    const task = await getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const project = await getProject(task.projectId);
    if (!project) throw new Error(`project ${task.projectId} not found`);
    const repoExists = Boolean(project.repoPath) && fs.existsSync(project.repoPath);

    const systemPrompt = buildBreakdownPrompt({ prompt, cap });

    const result = await runPlannerCli({
      prompt: systemPrompt,
      cwd: repoExists ? project.repoPath : null,
    });
    // F3: breakdown spend goes to the parent task's lifetime cost.
    if (result.costUsd > 0) {
      const withCost = addTaskCost(taskId, result.costUsd);
      if (withCost) broadcastTaskUpdated(withCost);
    }

    if (result.code !== 0) {
      throw new Error(`claude CLI exited ${result.code}: ${result.stderr.slice(0, 500)}`);
    }

    const parsed = extractJsonArray(result.stdout);
    const items = normalizeTasks(parsed, cap);

    // zincir F3 (§3/7, §5.5): subtasks chain among themselves; root subtasks
    // (no dependency inside the breakdown) inherit the parent's dependencies.
    const parentDeps = listDependencies(task.id);
    const createdIds: string[] = [];
    for (const item of items) {
      const created = await createTask({
        projectId: task.projectId,
        title: item.title,
        description: item.description,
        analysis: item.analysis,
        status: "todo",
        priority: item.priority,
        tags: item.tags,
        parentTaskId: task.id,
        dependsOn:
          item.dependsOn.length > 0 ? item.dependsOn.map((i) => createdIds[i]!) : parentDeps,
      });
      createdIds.push(created.id);
      broadcastTaskCreated(created);
      await new Promise((r) => setTimeout(r, 200));
    }

    // Fan-in: whatever waits on the parent now also waits on every subtask,
    // BEFORE the parent becomes done; its done trigger then starts nothing early.
    linkParentDependents(task.id, createdIds);

    await closeBrokenDownParent(taskId, items.length, uiLang);
    broadcastTaskBreakdownDone(taskId, items.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[taskBreakdown] task ${taskId} failed:`, message);
    broadcastTaskBreakdownError(taskId, message);
  }
}
