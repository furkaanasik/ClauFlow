import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClaude, type ClaudeRunResult } from "../services/claudeService.js";
import type { TaskPriority } from "../types/index.js";
import { costFromResult } from "./roleRunner.js";

/**
 * Shared by the project planner and the task breakdown runner (A7c): JSON
 * parsing of the planner reply and the isolated, read-only CLI call.
 */

export interface PlannedTaskItem {
  title: string;
  description: string;
  analysis: string;
  priority: TaskPriority;
  tags: string[];
}

export const VALID_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

export function unwrapEnvelope(raw: string): { text: string; envelopeError?: string } {
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

export function recoverArrayObjects(text: string): unknown[] {
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
    if (!closed) break; // truncation reached
  }
  return objects;
}

export function extractJsonArray(raw: string): unknown {
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

export function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== "string") return "medium";
  const lower = value.trim().toLowerCase();
  return (VALID_PRIORITIES as readonly string[]).includes(lower)
    ? (lower as TaskPriority)
    : "medium";
}

export function normalizeTags(value: unknown): string[] {
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

export function normalizeTasks(parsed: unknown, maxTasks: number): PlannedTaskItem[] {
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

/** Read-only exploration tools; never `--allowedTools` (bypass mode ignores it). */
export const PLANNER_TOOLS = ["Read", "Glob", "Grep"];
export const PLANNER_SETTING_SOURCES = ["project", "local"];

export interface PlannerCliResult extends ClaudeRunResult {
  /** The call's `total_cost_usd` from the JSON envelope (0 when missing). */
  costUsd: number;
}

/** Cost reported in a `--output-format json` envelope, or 0. */
export function plannerCostFromStdout(stdout: string): number {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return 0;
  try {
    return costFromResult(JSON.parse(trimmed), null) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * One planner CLI call, isolated like the team roles (§7): `--tools`
 * restricts the tool set, user MCP servers and user settings/hooks are
 * skipped. With a repo (`cwd`) the planner may only read it; without one it
 * runs with no tools at all in an empty temp directory, never in ClauFlow's
 * own folder.
 */
export async function runPlannerCli(opts: {
  prompt: string;
  cwd: string | null;
  signal?: AbortSignal;
}): Promise<PlannerCliResult> {
  const scratch = opts.cwd ? null : mkdtempSync(path.join(tmpdir(), "clauflow-planner-"));
  try {
    const result = await runClaude({
      prompt: opts.prompt,
      cwd: opts.cwd ?? scratch!,
      tools: opts.cwd ? PLANNER_TOOLS : [],
      strictMcpConfig: true,
      settingSources: PLANNER_SETTING_SOURCES,
      outputFormat: "json",
      maxOutputTokens: 32000,
      signal: opts.signal,
    });
    return { ...result, costUsd: plannerCostFromStdout(result.stdout) };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
