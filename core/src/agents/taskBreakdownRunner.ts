import fs from "node:fs";
import { runClaude } from "../services/claudeService.js";
import { getTask, getProject, createTask, updateTask } from "../services/taskService.js";
import type { TaskPriority } from "../types/index.js";
import {
  broadcastTaskCreated,
  broadcastTaskUpdated,
  broadcastTaskBreakdownStarted,
  broadcastTaskBreakdownDone,
  broadcastTaskBreakdownError,
} from "../services/wsService.js";

interface PlannedTaskItem {
  title: string;
  description: string;
  analysis: string;
  priority: TaskPriority;
  tags: string[];
}

const VALID_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

function unwrapEnvelope(raw: string): { text: string; envelopeError?: string } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return { text: trimmed };
  try {
    const env = JSON.parse(trimmed) as {
      result?: unknown;
      is_error?: unknown;
      error?: unknown;
    };
    if (env.is_error === true) {
      const errText = typeof env.error === "string" ? env.error
        : typeof env.result === "string" ? env.result
        : JSON.stringify(env);
      return { text: typeof env.result === "string" ? env.result : "", envelopeError: errText };
    }
    if (typeof env.result === "string") return { text: env.result };
    return { text: trimmed };
  } catch {
    return { text: trimmed };
  }
}

function recoverArrayObjects(text: string): unknown[] {
  const arrStart = text.indexOf("[");
  if (arrStart === -1) return [];
  const objects: unknown[] = [];
  let i = arrStart + 1;
  while (i < text.length) {
    while (i < text.length && text[i] !== "{") i++;
    if (i >= text.length) break;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let closed = false;
    while (i < text.length) {
      const ch = text[i]!;
      if (escape) { escape = false; i++; continue; }
      if (ch === "\\") { escape = true; i++; continue; }
      if (ch === '"') { inString = !inString; i++; continue; }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try {
              objects.push(JSON.parse(text.slice(start, i + 1)));
            } catch {
              // skip malformed object
            }
            closed = true;
            i++;
            break;
          }
        }
      }
      i++;
    }
    if (!closed) break;
  }
  return objects;
}

function extractJsonArray(raw: string): unknown {
  const { text, envelopeError } = unwrapEnvelope(raw);
  if (envelopeError) {
    throw new Error(`claude returned an error envelope: ${envelopeError.slice(0, 400)}`);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("claude response was empty");
  }
  const fenced = trimmed.startsWith("```") ? trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) : null;
  const candidate = fenced ? fenced[1]!.trim() : trimmed;

  // Try full parse first (avoids lastIndexOf finding ] inside string values)
  try {
    const full = JSON.parse(candidate);
    if (Array.isArray(full)) return full;
  } catch {
    // fall through
  }

  // Slice from first [ to last ] — only reliable when JSON is complete
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // fall through to recovery
    }
  }

  const recovered = recoverArrayObjects(candidate);
  if (recovered.length > 0) return recovered;

  const snippet = trimmed.slice(0, 400).replace(/\s+/g, " ");
  throw new Error(
    `claude response did not contain a JSON array. Response was: "${snippet}${trimmed.length > 400 ? "…" : ""}"`,
  );
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
    const rawAnalysis =
      typeof obj.analysis === "string" ? obj.analysis.trim() : "";
    if (!rawTitle) continue;
    items.push({
      title: rawTitle.slice(0, 80),
      description: rawDescription,
      analysis: rawAnalysis || rawDescription,
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

export async function runTaskBreakdown(
  taskId: string,
  prompt: string,
  maxTasks: number = 6,
): Promise<void> {
  const cap = Math.max(1, Math.min(Math.floor(maxTasks) || 6, 20));
  try {
    broadcastTaskBreakdownStarted(taskId);
    const task = await getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const project = await getProject(task.projectId);
    if (!project) throw new Error(`project ${task.projectId} not found`);
    const cwd = project.repoPath && fs.existsSync(project.repoPath)
      ? project.repoPath
      : process.cwd();

    const systemPrompt =
      `You are a task planner. Break the following task description into at most ${cap} ` +
      `small, actionable subtasks.\n\nTask:\n${prompt}\n\n` +
      `Return ONLY a JSON array, no other text. Each item must be an object with these fields:\n` +
      `  - "title": string, max 80 chars, imperative ("Add login endpoint")\n` +
      `  - "description": ONE short sentence (max ~160 chars) summarizing the subtask\n` +
      `  - "analysis": markdown technical brief, KEEP UNDER ~180 WORDS to fit response budget\n` +
      `  - "priority": one of "low" | "medium" | "high" | "critical" (default "medium")\n` +
      `  - "tags": optional array of 1-4 short lowercase strings\n\n` +
      `Order tasks in execution sequence. Output strictly valid JSON — no commentary, no code fences.`;

    const result = await runClaude({
      prompt: systemPrompt,
      cwd,
      outputFormat: "json",
      maxOutputTokens: 32000,
    });

    if (result.code !== 0) {
      throw new Error(`claude CLI exited ${result.code}: ${result.stderr.slice(0, 500)}`);
    }

    const parsed = extractJsonArray(result.stdout);
    const items = normalizeTasks(parsed, cap);

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
      });
      broadcastTaskCreated(created);
      await new Promise((r) => setTimeout(r, 200));
    }

    const archived = await updateTask(taskId, { status: "nothing" });
    broadcastTaskUpdated(archived);
    broadcastTaskBreakdownDone(taskId, items.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[taskBreakdown] task ${taskId} failed:`, message);
    broadcastTaskBreakdownError(taskId, message);
  }
}
