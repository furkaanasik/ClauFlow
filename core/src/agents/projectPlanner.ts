import { runClaude } from "../services/claudeService.js";
import { createTask, updateProject } from "../services/taskService.js";
import {
  broadcastProjectPlanningDone,
  broadcastProjectPlanningError,
  broadcastProjectPlanningStarted,
  broadcastTaskCreated,
} from "../services/wsService.js";

interface PlannedTaskItem {
  title: string;
  description: string;
}

function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("claude response did not contain a JSON array");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeTasks(parsed: unknown, maxTasks: number): PlannedTaskItem[] {
  if (!Array.isArray(parsed)) {
    throw new Error("claude response was not a JSON array");
  }
  const items: PlannedTaskItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const rawTitle = typeof obj.title === "string" ? obj.title.trim() : "";
    const rawDescription =
      typeof obj.description === "string" ? obj.description.trim() : "";
    if (!rawTitle) continue;
    items.push({
      title: rawTitle.slice(0, 80),
      description: rawDescription,
    });
    if (items.length >= maxTasks) break;
  }
  if (items.length === 0) {
    throw new Error("claude response contained no usable tasks");
  }
  return items;
}

export async function runProjectPlanner(
  projectId: string,
  aiPrompt: string,
  maxTasks: number = 8,
): Promise<void> {
  const cap = Math.max(1, Math.min(Math.floor(maxTasks) || 8, 20));

  try {
    await updateProject(projectId, { planningStatus: "planning" });
    broadcastProjectPlanningStarted(projectId);

    const systemPrompt =
      `You are a project planner. Break the following project description into at most ${cap} small, actionable tasks.\n\n` +
      `Project description:\n${aiPrompt}\n\n` +
      `Return ONLY a JSON array, no other text. Each item: { "title": "short title (max 80 chars)", "description": "1-2 sentence description" }.`;

    const result = await runClaude({
      prompt: systemPrompt,
      cwd: process.cwd(),
    });

    if (result.code !== 0) {
      throw new Error(
        `claude CLI exited ${result.code}: ${result.stderr.slice(0, 500)}`,
      );
    }

    const parsed = extractJsonArray(result.stdout);
    const items = normalizeTasks(parsed, cap);

    for (const item of items) {
      const task = await createTask({
        projectId,
        title: item.title,
        description: item.description,
        status: "todo",
      });
      broadcastTaskCreated(task);
      await new Promise((r) => setTimeout(r, 200));
    }

    await updateProject(projectId, { planningStatus: "done" });
    broadcastProjectPlanningDone(projectId, items.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[projectPlanner] project ${projectId} failed:`, message);
    try {
      await updateProject(projectId, { planningStatus: "error" });
    } catch (updateErr) {
      console.error(
        `[projectPlanner] failed to mark project ${projectId} as error:`,
        updateErr,
      );
    }
    broadcastProjectPlanningError(projectId, message);
  }
}
