import { runClaude } from "../services/claudeService.js";
import { createTask, updateProject } from "../services/taskService.js";
import type { TaskPriority } from "../types/index.js";
import {
  broadcastProjectPlanningDone,
  broadcastProjectPlanningError,
  broadcastProjectPlanningStarted,
  broadcastTaskCreated,
} from "../services/wsService.js";

interface PlannedTaskItem {
  title: string;
  description: string;
  priority: TaskPriority;
  tags: string[];
}

const VALID_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

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

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== "string") return "medium";
  const lower = value.trim().toLowerCase();
  return (VALID_PRIORITIES as readonly string[]).includes(lower)
    ? (lower as TaskPriority)
    : "medium";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    tags.push(trimmed.slice(0, 32));
    if (tags.length >= 6) break;
  }
  return tags;
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
      priority: normalizePriority(obj.priority),
      tags: normalizeTags(obj.tags),
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
      `Return ONLY a JSON array, no other text. Each item must be an object with these fields:\n` +
      `  - "title": string, max 80 chars, imperative ("Add login endpoint")\n` +
      `  - "description": 2-4 sentences of context followed by 2-3 markdown bullet acceptance criteria. Example:\n` +
      `      "Implements the login endpoint with email/password auth. Tokens are JWT and stored httpOnly.\\n\\n- [ ] POST /auth/login returns 200 with token on valid creds\\n- [ ] Returns 401 on invalid creds\\n- [ ] Rate-limited to 5 attempts/min per IP"\n` +
      `  - "priority": one of "low" | "medium" | "high" | "critical" (default "medium" if unsure)\n` +
      `  - "tags": optional array of 1-4 short lowercase strings like ["backend","api"] or ["frontend","ui"]; omit if not relevant\n\n` +
      `Output strictly valid JSON — no commentary, no code fences.`;

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
        priority: item.priority,
        tags: item.tags,
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
