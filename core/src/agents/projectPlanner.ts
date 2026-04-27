import fs from "node:fs";
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
    if (!closed) break; // truncation reached
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
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;

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

export async function runProjectPlanner(
  projectId: string,
  aiPrompt: string,
  maxTasks: number = 8,
): Promise<void> {
  const cap = Math.max(1, Math.min(Math.floor(maxTasks) || 8, 20));

  try {
    const project = await updateProject(projectId, { planningStatus: "planning" });
    broadcastProjectPlanningStarted(projectId);

    const repoExists =
      Boolean(project.repoPath) && fs.existsSync(project.repoPath);
    const cwd = repoExists ? project.repoPath : process.cwd();

    const codebaseHint = repoExists
      ? `Before planning, explore the working directory ("${cwd}") with Read/Glob/Grep ` +
        `to learn this project's actual conventions: list top-level files; peek at package.json/README; ` +
        `scan src/services, src/agents, src/routes, src/types if they exist. ` +
        `Plan tasks that REUSE the discovered services and patterns instead of inventing new ones, ` +
        `and reference real file paths from your exploration. Do not write or edit files — read-only.\n\n`
      : `The project has no existing repo on disk. Plan as a greenfield build, but apply the defensive defaults below.\n\n`;

    const defensiveDefaults =
      `Defensive defaults — apply automatically when relevant, no need to be told:\n` +
      `- If a task calls a Claude/LLM CLI for STRUCTURED output, mandate \`--output-format json\` ` +
      `and parsing the envelope's "result" field — never JSON.parse the raw stdout. ` +
      `If the codebase already exposes a runner (e.g. \`claudeService.runClaude({ outputFormat: "json" })\`), reuse it.\n` +
      `- Defend against truncated/partial LLM responses: prefer recovery-style parsers that extract complete top-level objects rather than strict full-document parses.\n` +
      `- For prose/idea text inputs at API boundaries, default zod max-length to ≥6000 chars unless a stricter cap is clearly justified by the domain.\n` +
      `- Reuse existing wrappers/services discovered during the repo scan; do not duplicate spawn/CLI/db plumbing.\n\n`;

    const systemPrompt =
      codebaseHint +
      defensiveDefaults +
      `You are a project planner. Break the following project description into at most ${cap} small, actionable tasks.\n\n` +
      `Project description:\n${aiPrompt}\n\n` +
      `Return ONLY a JSON array, no other text. Each item must be an object with these fields:\n` +
      `  - "title": string, max 80 chars, imperative ("Add login endpoint")\n` +
      `  - "description": ONE short sentence (max ~160 chars) summarizing the task for a human skimming the board. No bullets, no acceptance criteria here. Example: "Add a JWT-backed login endpoint guarded against brute force."\n` +
      `  - "analysis": markdown technical brief, KEEP UNDER ~180 WORDS PER TASK to fit the response budget. Structure:\n` +
      `      1) 1-2 sentences of context (what/why)\n` +
      `      2) **Implementation** bullets: files/modules, key signatures, libraries, edge cases — terse, no prose paragraphs\n` +
      `      3) **Acceptance criteria** — 3-5 testable checkbox bullets ("- [ ] ...")\n` +
      `      4) If depending on a prior task, name it in one line\n` +
      `      Example (note brevity):\n` +
      `      "Adds POST /api/auth/login with httpOnly JWT cookies.\\n\\n**Implementation**\\n- src/routes/auth.ts; zod body { email, password }\\n- bcrypt compare → JWT signed with JWT_SECRET\\n- Set-Cookie: HttpOnly; Secure; SameSite=Strict; 1h\\n- Reuse rateLimit middleware (5/min/IP)\\n\\n**Acceptance criteria**\\n- [ ] 200 + Set-Cookie on valid creds\\n- [ ] 401 on unknown email or wrong password\\n- [ ] 400 on malformed body\\n- [ ] 429 after 5 attempts/min"\n` +
      `  - "priority": one of "low" | "medium" | "high" | "critical" (default "medium" if unsure)\n` +
      `  - "tags": optional array of 1-4 short lowercase strings like ["backend","api"] or ["frontend","ui"]; omit if not relevant\n\n` +
      `Order the tasks in strict execution sequence so they can be picked up one by one without rework: ` +
      `shared contracts (schemas, types, DB models) first; backend endpoints before any frontend that consumes them; ` +
      `parent UI/layout before child components; cross-cutting concerns (auth, rate limiting, persistence of prior outputs) last. ` +
      `If task B depends on task A, A must appear before B in the array.\n\n` +
      `If the project looks greenfield (no existing stack mentioned), include an early task that scaffolds a minimal test runner ` +
      `appropriate for the stack (vitest for TS/JS, pytest for Python, go test for Go). Each behavior task's acceptance criteria ` +
      `should already read as testable assertions so the executor can turn them into real tests.\n\n` +
      `Output strictly valid JSON — no commentary, no code fences.`;

    const result = await runClaude({
      prompt: systemPrompt,
      cwd,
      outputFormat: "json",
      maxOutputTokens: 32000,
      allowedTools: repoExists ? ["Read", "Glob", "Grep"] : undefined,
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
        analysis: item.analysis,
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
