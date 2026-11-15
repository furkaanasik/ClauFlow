import fs from "node:fs";
import { addProjectPlanningCost, createTask, updateProject } from "../services/taskService.js";
import { extractJsonArray, normalizeTasks, runPlannerCli } from "./plannerShared.js";
import {
  broadcastProjectPlanningDone,
  broadcastProjectPlanningError,
  broadcastProjectPlanningStarted,
  broadcastTaskCreated,
} from "../services/wsService.js";

/**
 * Planner prompt. Kept generic (A7b): it runs against the user's projects, so
 * it never names ClauFlow's own folders, services or limits.
 */
export function buildPlannerPrompt(opts: { aiPrompt: string; cap: number; repoExists: boolean }): string {
  const { aiPrompt, cap, repoExists } = opts;
  const codebaseHint = repoExists
    ? `Before planning, explore the working directory with Read/Glob/Grep ` +
      `to learn this project's actual conventions: list top-level files; peek at the manifest and README; ` +
      `scan the main source folders. ` +
      `Plan tasks that REUSE the discovered services and patterns instead of inventing new ones, ` +
      `and reference real file paths from your exploration. You cannot write or edit files — read-only.\n\n`
    : `The project has no existing repo on disk. Plan as a greenfield build, but apply the defensive defaults below.\n\n`;

  const defensiveDefaults =
    `Defensive defaults — apply automatically when relevant, no need to be told:\n` +
    `- If a task asks an LLM for STRUCTURED output, mandate a JSON envelope (e.g. the CLI's JSON output mode) ` +
    `and parsing its result field — never parse the raw text output directly.\n` +
    `- Defend against truncated/partial LLM responses: prefer recovery-style parsers that extract complete top-level objects rather than strict full-document parses.\n` +
    `- Give free-text inputs at API boundaries an explicit, generous max length that suits the domain.\n` +
    `- Reuse the existing services and wrappers you discovered; do not duplicate process, CLI or database plumbing.\n\n`;

  return (
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
    `Output strictly valid JSON — no commentary, no code fences.`
  );
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

    const systemPrompt = buildPlannerPrompt({ aiPrompt, cap, repoExists });

    const result = await runPlannerCli({
      prompt: systemPrompt,
      cwd: repoExists ? project.repoPath : null,
    });
    // F3: planner spend belongs to the project, not to any task.
    if (result.costUsd > 0) addProjectPlanningCost(projectId, result.costUsd);

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
