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
    await updateProject(projectId, { planningStatus: "planning" });
    broadcastProjectPlanningStarted(projectId);

    const systemPrompt =
      `You are a project planner. Break the following project description into at most ${cap} small, actionable tasks.\n\n` +
      `Project description:\n${aiPrompt}\n\n` +
      `Return ONLY a JSON array, no other text. Each item must be an object with these fields:\n` +
      `  - "title": string, max 80 chars, imperative ("Add login endpoint")\n` +
      `  - "description": ONE short sentence (max ~160 chars) summarizing the task for a human skimming the board. No bullets, no acceptance criteria here. Example: "Add a JWT-backed login endpoint guarded against brute force."\n` +
      `  - "analysis": the primary artifact. A detailed technical brief the coding agent will implement from, written in markdown. Include:\n` +
      `      1) 2-4 sentences of context (what/why, how it fits the system)\n` +
      `      2) Concrete implementation notes: files or modules to touch, function/endpoint signatures, request/response shapes, key libraries or patterns to follow, relevant edge cases or failure modes\n` +
      `      3) An "Acceptance criteria" section with 3-6 testable checkboxes that map directly to unit/integration test assertions\n` +
      `      4) If the task depends on outputs of earlier tasks, name them explicitly so the agent knows what contracts already exist\n` +
      `      Example shape:\n` +
      `      "Adds the email/password login endpoint using httpOnly JWT cookies.\\n\\n**Implementation**\\n- Route: POST /api/auth/login in src/routes/auth.ts\\n- Body: zod { email, password } — 400 on parse fail\\n- Compare bcrypt hash from users table; emit JWT signed with JWT_SECRET\\n- Set-Cookie: token; HttpOnly; Secure; SameSite=Strict; 1h TTL\\n- Rate limit: 5 attempts / IP / minute via existing rateLimit middleware\\n\\n**Acceptance criteria**\\n- [ ] POST /api/auth/login returns 200 + Set-Cookie on valid creds\\n- [ ] Returns 401 on unknown email or wrong password\\n- [ ] Returns 400 on malformed body\\n- [ ] 6th attempt within 60s from same IP returns 429 with Retry-After"\n` +
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
