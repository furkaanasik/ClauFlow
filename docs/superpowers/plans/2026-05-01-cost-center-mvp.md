# Cost Center MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project monthly USD budget, spend breakdown, per-task model override, and a Costs tab inside `ProjectDetailDrawer`, with a soft `warn` and a hard `block` enforcement option on DOING transitions.

**Architecture:** Three new columns on `projects`, one on `tasks`. A pure `pricingService` recomputes USD from token counts on every read (no historical USD persisted). The Costs tab is the third drawer tab next to `overview` and `claude`. WS event `cost_update` keeps the progress bar live.

**Tech Stack:** Node.js + Express + better-sqlite3 + vitest (backend); Next.js 15 + Tailwind 4 + Zustand (frontend).

**Spec:** `docs/superpowers/specs/2026-05-01-cost-center-mvp-design.md`

---

## File Structure

**New:**
- `core/src/services/pricingService.ts` — pure `tokens × model → USD`, plus per-month / per-day aggregation helpers that consume rows from `taskService`.
- `core/src/services/pricingService.test.ts` — vitest unit tests.
- `gui/src/components/Modals/CostsTab.tsx` — drawer tab UI (summary card + sparkline + breakdown table + budget editor).

**Modified backend:**
- `core/src/types/index.ts` — extend `Project`, `Task`, `WsMessage`; add `ProjectCosts` shape.
- `core/src/services/taskService.ts` — three new project columns + one task column (idempotent migration), row converters, `getProjectMonthSpend`, `getProjectDailySpend`, `getProjectMonthBreakdown`, `model` field on insert/update.
- `core/src/services/claudeService.ts` — add `model?: string` to `ClaudeRunOptions`, thread it as `--model <name>` flag.
- `core/src/agents/executor.ts` — model resolution chain (`task.model ?? project.defaultModel ?? GLOBAL_DEFAULT`), persist resolved model on the task, broadcast `cost_update` after completion.
- `core/src/routes/projects.ts` — accept new fields in PATCH; add `GET /api/projects/:id/costs`.
- `core/src/routes/tasks.ts` — accept `model` in POST/PATCH; on `status: 'doing'` transitions, run the budget block check.
- `core/src/services/wsService.ts` — `broadcastCostUpdate(projectId, totalUsd, budgetUsd)` helper.

**Modified frontend:**
- `gui/src/lib/i18n/types.ts`, `en.ts`, `tr.ts` — add `costsTab` namespace.
- `gui/src/lib/api.ts` — typed wrappers for the new endpoints.
- `gui/src/store/boardStore.ts` — costs cache per projectId + `cost_update` handler.
- `gui/src/hooks/useAgentSocket.ts` — wire `cost_update`.
- `gui/src/components/Modals/AddTaskModal.tsx` — model dropdown.
- `gui/src/components/Modals/ProjectDetailDrawer.tsx` — add `costs` tab.
- `gui/src/components/Layout/Header.tsx` — small "this month: $X" badge.

---

## Constants

Used across multiple tasks — keep these names/values consistent.

```ts
// core/src/services/pricingService.ts
export const GLOBAL_DEFAULT_MODEL = "claude-sonnet-4-6";
export const SUPPORTED_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export interface ModelRate {
  input: number;        // USD per 1M input tokens
  output: number;       // USD per 1M output tokens
  cacheRead: number;    // USD per 1M cache-read tokens
  cacheWrite: number;   // USD per 1M cache-write tokens
}

export const PRICING: Record<string, ModelRate> = {
  "claude-opus-4-7":   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input:  3.00, output: 15.00, cacheRead: 0.30, cacheWrite:  3.75 },
  "claude-haiku-4-5":  { input:  1.00, output:  5.00, cacheRead: 0.10, cacheWrite:  1.25 },
};
```

```ts
// shared shape — emitted from /costs endpoint and stored in boardStore
export interface ProjectCosts {
  period: { start: string; end: string };
  totalUsd: number;
  budgetUsd: number | null;
  enforcement: "off" | "warn" | "block";
  defaultModel: string | null;
  breakdown: Array<{
    taskId: string;
    displayId: string | null;
    title: string;
    model: string;
    tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
    costUsd: number;
    completedAt: string;
  }>;
  daily: Array<{ date: string; costUsd: number }>;
}
```

---

### Task 1: Pricing service — pure math + tests

**Files:**
- Create: `core/src/services/pricingService.ts`
- Create: `core/src/services/pricingService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/src/services/pricingService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  costForUsage,
  GLOBAL_DEFAULT_MODEL,
  PRICING,
  resolveModel,
} from "./pricingService.js";

describe("costForUsage", () => {
  it("computes opus cost from token counts (per 1M)", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costForUsage("claude-opus-4-7", usage)).toBeCloseTo(15.0, 6);
  });

  it("sums input + output + cache rates", () => {
    const usage = { inputTokens: 100_000, outputTokens: 50_000, cacheReadTokens: 200_000, cacheWriteTokens: 0 };
    // sonnet: 0.1*3 + 0.05*15 + 0.2*0.30 = 0.3 + 0.75 + 0.06 = 1.11
    expect(costForUsage("claude-sonnet-4-6", usage)).toBeCloseTo(1.11, 6);
  });

  it("falls back to sonnet pricing for unknown models", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costForUsage("totally-made-up-model", usage)).toBeCloseTo(PRICING["claude-sonnet-4-6"].input, 6);
  });

  it("handles zero usage", () => {
    expect(costForUsage("claude-opus-4-7", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    })).toBe(0);
  });
});

describe("resolveModel", () => {
  it("prefers task model over project default", () => {
    expect(resolveModel("claude-opus-4-7", "claude-sonnet-4-6")).toBe("claude-opus-4-7");
  });
  it("falls back to project default when task model is null", () => {
    expect(resolveModel(null, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
  it("falls back to global default when both are null", () => {
    expect(resolveModel(null, null)).toBe(GLOBAL_DEFAULT_MODEL);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd core && npx vitest run src/services/pricingService.test.ts
```

Expected: FAIL with "Cannot find module './pricingService.js'".

- [ ] **Step 3: Implement the service**

Create `core/src/services/pricingService.ts`:

```ts
export const GLOBAL_DEFAULT_MODEL = "claude-sonnet-4-6";
export const SUPPORTED_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICING: Record<string, ModelRate> = {
  "claude-opus-4-7":   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input:  3.00, output: 15.00, cacheRead: 0.30, cacheWrite:  3.75 },
  "claude-haiku-4-5":  { input:  1.00, output:  5.00, cacheRead: 0.10, cacheWrite:  1.25 },
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costForUsage(model: string, usage: TokenCounts): number {
  const rate = PRICING[model] ?? PRICING[GLOBAL_DEFAULT_MODEL];
  return (
    (usage.inputTokens * rate.input +
      usage.outputTokens * rate.output +
      usage.cacheReadTokens * rate.cacheRead +
      usage.cacheWriteTokens * rate.cacheWrite) /
    1_000_000
  );
}

export function resolveModel(
  taskModel: string | null | undefined,
  projectDefaultModel: string | null | undefined,
): string {
  return taskModel ?? projectDefaultModel ?? GLOBAL_DEFAULT_MODEL;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd core && npx vitest run src/services/pricingService.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add core/src/services/pricingService.ts core/src/services/pricingService.test.ts
git commit -m "feat(cost): add pricingService with tokens→USD math + model resolver"
```

---

### Task 2: Extend types — Project, Task, WsMessage, ProjectCosts

**Files:**
- Modify: `core/src/types/index.ts`

- [ ] **Step 1: Edit the Task interface to add `model`**

In `core/src/types/index.ts`, change the `Task` interface (around line 30–47):

Replace `usage?: TaskUsage;` block with:

```ts
  usage?: TaskUsage;
  model?: string | null;
}
```

- [ ] **Step 2: Edit the Project interface to add budget fields**

In the same file, change the `Project` interface (around line 51–63). Replace `taskCounter?: number;` with:

```ts
  taskCounter?: number;
  monthlyBudgetUsd?: number | null;
  defaultModel?: string | null;
  budgetEnforcement?: "off" | "warn" | "block";
}
```

- [ ] **Step 3: Add `ProjectCosts` shape and `cost_update` WS event**

After the `WsMessage` union, add (or insert as a new branch):

Append to the union (before the closing `;`):

```ts
  | {
      type: "cost_update";
      projectId: string;
      payload: { totalUsd: number; budgetUsd: number | null; percentage: number | null };
    }
```

And below the `WsMessage` union, add:

```ts
export interface ProjectCostsBreakdownRow {
  taskId: string;
  displayId: string | null;
  title: string;
  model: string;
  tokens: TaskUsage;
  costUsd: number;
  completedAt: string;
}

export interface ProjectCosts {
  period: { start: string; end: string };
  totalUsd: number;
  budgetUsd: number | null;
  enforcement: "off" | "warn" | "block";
  defaultModel: string | null;
  breakdown: ProjectCostsBreakdownRow[];
  daily: Array<{ date: string; costUsd: number }>;
}
```

- [ ] **Step 4: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add core/src/types/index.ts
git commit -m "feat(cost): extend Project/Task/WsMessage types for budgets + cost_update"
```

---

### Task 3: SQLite migration — three project cols + one task col + row converters

**Files:**
- Modify: `core/src/services/taskService.ts:200-240` (migration block)
- Modify: `core/src/services/taskService.ts:254-300` (row types)
- Modify: `core/src/services/taskService.ts:340-370` (row → Task converter)

- [ ] **Step 1: Add three project columns to the migration**

Find the project migration block (currently around line 200–214, ends after `taskCounter`). Just before its closing `}`, add:

```ts
  const hasMonthlyBudgetUsd = projectColumns.some((c) => c.name === "monthlyBudgetUsd");
  if (!hasMonthlyBudgetUsd) {
    db.exec(`ALTER TABLE projects ADD COLUMN monthlyBudgetUsd REAL`);
  }
  const hasDefaultModel = projectColumns.some((c) => c.name === "defaultModel");
  if (!hasDefaultModel) {
    db.exec(`ALTER TABLE projects ADD COLUMN defaultModel TEXT`);
  }
  const hasBudgetEnforcement = projectColumns.some((c) => c.name === "budgetEnforcement");
  if (!hasBudgetEnforcement) {
    db.exec(
      `ALTER TABLE projects ADD COLUMN budgetEnforcement TEXT NOT NULL DEFAULT 'warn'`,
    );
  }
```

- [ ] **Step 2: Add the task `model` column**

In the `tasks` migration block (around line 215–239), after the `usageCols` loop, append:

```ts
  if (!taskColumns.some((c) => c.name === "model")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN model TEXT`);
  }
```

- [ ] **Step 3: Update `ProjectRow` and converter**

Find the `ProjectRow` interface (around line 254). Add fields:

```ts
  monthlyBudgetUsd: number | null;
  defaultModel: string | null;
  budgetEnforcement: string | null;
```

Find the `rowToProject` function (search for `function rowToProject`). Add to the returned object:

```ts
    monthlyBudgetUsd: row.monthlyBudgetUsd,
    defaultModel: row.defaultModel,
    budgetEnforcement: (row.budgetEnforcement ?? "warn") as "off" | "warn" | "block",
```

- [ ] **Step 4: Update `TaskRow` and converter for `model`**

Find the `TaskRow` interface (search for `interface TaskRow`). Add:

```ts
  model: string | null;
```

Find the `rowToTask` function. Add to the returned object:

```ts
    model: row.model,
```

- [ ] **Step 5: Update `INSERT` / `UPDATE` statements that touch projects + tasks**

Search for `INSERT INTO projects` — add the three new columns to the column list and `@monthlyBudgetUsd, @defaultModel, @budgetEnforcement` to VALUES. Pass `null, null, 'warn'` from any `createProject` callsite.

Search for `INSERT INTO tasks` — add `model` to columns + `@model` to VALUES. Pass `null` from any `createTask` callsite that doesn't yet supply it.

Search for `UPDATE projects SET` — extend the patch builder to allow `monthlyBudgetUsd`, `defaultModel`, `budgetEnforcement`. Use the existing dynamic-set pattern in the file (the same approach used for `aiPrompt` etc.).

Search for `UPDATE tasks SET` — extend the patch builder to allow `model`.

(If the file already uses a generic `pickAllowedFields` helper, just add the new keys to the allow-list.)

- [ ] **Step 6: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 7: Run dev once to apply migration**

```bash
cd core && npm run dev
```

Wait until the server logs "ready". Stop it with Ctrl-C. The migration runs once on boot — verify by re-running `PRAGMA table_info(projects)` in `data/tasks.db` if you want, but the lack of crash + clean typecheck is enough.

- [ ] **Step 8: Commit**

```bash
git add core/src/services/taskService.ts
git commit -m "feat(cost): add projects.monthlyBudgetUsd/defaultModel/budgetEnforcement and tasks.model columns"
```

---

### Task 4: Spend aggregation helpers in taskService

**Files:**
- Modify: `core/src/services/taskService.ts` (add new exports near the bottom, after the existing usage update statements at line ~1180)

- [ ] **Step 1: Add the helpers**

Append to `core/src/services/taskService.ts`:

```ts
// ─── Cost Aggregation ─────────────────────────────────────────────────────

import { costForUsage, resolveModel } from "./pricingService.js";

const stmtMonthRows = db.prepare(
  `SELECT id, displayId, title, model, status,
          inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
          updatedAt
     FROM tasks
    WHERE projectId = @projectId
      AND updatedAt >= @monthStartIso
      AND updatedAt <  @monthEndIso`,
);

export interface MonthSpendRow {
  taskId: string;
  displayId: string | null;
  title: string;
  model: string;
  costUsd: number;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  completedAt: string;
}

export function getProjectMonthBreakdown(
  projectId: string,
  monthStart: Date,
  projectDefaultModel: string | null,
): { totalUsd: number; rows: MonthSpendRow[] } {
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const raw = stmtMonthRows.all({
    projectId,
    monthStartIso: monthStart.toISOString(),
    monthEndIso:   monthEnd.toISOString(),
  }) as Array<{
    id: string;
    displayId: string | null;
    title: string;
    model: string | null;
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    updatedAt: string;
  }>;

  let total = 0;
  const rows: MonthSpendRow[] = [];
  for (const r of raw) {
    const tokens = {
      inputTokens:     r.inputTokens     ?? 0,
      outputTokens:    r.outputTokens    ?? 0,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheWriteTokens:r.cacheWriteTokens ?? 0,
    };
    const model = resolveModel(r.model, projectDefaultModel);
    const costUsd = costForUsage(model, tokens);
    total += costUsd;
    rows.push({
      taskId: r.id,
      displayId: r.displayId,
      title: r.title,
      model,
      costUsd,
      tokens,
      completedAt: r.updatedAt,
    });
  }
  rows.sort((a, b) => b.costUsd - a.costUsd);
  return { totalUsd: total, rows };
}

export function getProjectDailySpend(
  projectId: string,
  windowDays: number,
  projectDefaultModel: string | null,
): Array<{ date: string; costUsd: number }> {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  start.setUTCHours(0, 0, 0, 0);

  const raw = db
    .prepare(
      `SELECT model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, updatedAt
         FROM tasks
        WHERE projectId = @projectId
          AND updatedAt >= @startIso`,
    )
    .all({ projectId, startIso: start.toISOString() }) as Array<{
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    updatedAt: string;
  }>;

  const buckets = new Map<string, number>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const r of raw) {
    const day = r.updatedAt.slice(0, 10);
    if (!buckets.has(day)) continue;
    const tokens = {
      inputTokens:     r.inputTokens     ?? 0,
      outputTokens:    r.outputTokens    ?? 0,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheWriteTokens:r.cacheWriteTokens ?? 0,
    };
    const model = resolveModel(r.model, projectDefaultModel);
    buckets.set(day, (buckets.get(day) ?? 0) + costForUsage(model, tokens));
  }

  return [...buckets.entries()].map(([date, costUsd]) => ({ date, costUsd }));
}

export function currentMonthStartUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
```

- [ ] **Step 2: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add core/src/services/taskService.ts
git commit -m "feat(cost): add getProjectMonthBreakdown / getProjectDailySpend"
```

---

### Task 5: Thread `model` through claudeService

**Files:**
- Modify: `core/src/services/claudeService.ts:193-208` (ClaudeRunOptions)
- Modify: `core/src/services/claudeService.ts:267-279` (runClaudeOnce args)

- [ ] **Step 1: Add `model` to `ClaudeRunOptions`**

In `ClaudeRunOptions`, after `maxRetries?: number;` add:

```ts
  model?: string;
```

- [ ] **Step 2: Pass `--model` to the CLI**

In `runClaudeOnce`, right after the line:

```ts
  const args = ["-p", options.prompt, "--permission-mode", "bypassPermissions"];
```

Add:

```ts
  if (options.model) {
    args.push("--model", options.model);
  }
```

- [ ] **Step 3: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add core/src/services/claudeService.ts
git commit -m "feat(cost): allow model override in ClaudeRunOptions"
```

---

### Task 6: Executor — resolve model, persist on task, broadcast cost_update

**Files:**
- Modify: `core/src/agents/executor.ts`

- [ ] **Step 1: Resolve model and persist on task**

Find where `executor.ts` calls `runClaude(...)` (search `runClaude(`). Above the call, fetch the project (it already does — confirm there's a `project` variable in scope; if not, add `const project = getProject(task.projectId);`).

Replace the `runClaude({ ... })` call to include the resolved model:

```ts
import { resolveModel } from "../services/pricingService.js";
// ...
const model = resolveModel(task.model ?? null, project.defaultModel ?? null);

// Persist the resolved model so historical replay/audit knows what ran.
if (task.model !== model) {
  updateTask(task.id, { model });
}

const result = await runClaude({
  // ...existing options...
  model,
});
```

(If `updateTask` does not yet accept `model` because Task 3 was incomplete, return to Task 3 and finish it.)

- [ ] **Step 2: Broadcast `cost_update` after completion**

At the end of the executor (after the task transitions to `review` or `done`), emit a cost update. Locate the final task-status update (search `setStatus("done"` or `setStatus("review"`). Right after that, add:

```ts
import { broadcastCostUpdate } from "../services/wsService.js"; // (Task 7 will define this)
import {
  getProjectMonthBreakdown,
  currentMonthStartUTC,
} from "../services/taskService.js";

// ... after the final status update:
const month = getProjectMonthBreakdown(
  task.projectId,
  currentMonthStartUTC(),
  project.defaultModel ?? null,
);
broadcastCostUpdate(
  task.projectId,
  month.totalUsd,
  project.monthlyBudgetUsd ?? null,
);
```

- [ ] **Step 3: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: will fail until Task 7 lands `broadcastCostUpdate`. That's fine — commit what we have now and finish Task 7 next.

- [ ] **Step 4: Commit**

```bash
git add core/src/agents/executor.ts
git commit -m "feat(cost): executor resolves model + emits cost_update after task completes"
```

---

### Task 7: WS broadcast helper

**Files:**
- Modify: `core/src/services/wsService.ts`

- [ ] **Step 1: Add the helper**

Append to `core/src/services/wsService.ts`:

```ts
export function broadcastCostUpdate(
  projectId: string,
  totalUsd: number,
  budgetUsd: number | null,
): void {
  const percentage = budgetUsd && budgetUsd > 0 ? (totalUsd / budgetUsd) * 100 : null;
  broadcast({
    type: "cost_update",
    projectId,
    payload: { totalUsd, budgetUsd, percentage },
  });
}
```

(Use whichever existing internal broadcast function the file uses — copy the style from `broadcastTaskUpdated` or similar.)

- [ ] **Step 2: Typecheck (full)**

```bash
cd core && npm run typecheck
```

Expected: clean — Task 6's import now resolves.

- [ ] **Step 3: Commit**

```bash
git add core/src/services/wsService.ts
git commit -m "feat(cost): add broadcastCostUpdate"
```

---

### Task 8: Project route — PATCH new fields, GET /costs

**Files:**
- Modify: `core/src/routes/projects.ts`

- [ ] **Step 1: Allow new fields in PATCH**

Find the PATCH handler (search `router.patch` or `app.patch`). Extend the body parser / pick-list to include `monthlyBudgetUsd`, `defaultModel`, `budgetEnforcement`. Mirror whatever pattern the file already uses for existing fields (e.g. `aiPrompt`).

Add validation:

```ts
if (body.monthlyBudgetUsd !== undefined && body.monthlyBudgetUsd !== null) {
  const n = Number(body.monthlyBudgetUsd);
  if (!Number.isFinite(n) || n < 0) {
    return res.status(400).json({ error: "monthlyBudgetUsd must be a non-negative number or null" });
  }
}
if (body.budgetEnforcement !== undefined &&
    !["off", "warn", "block"].includes(body.budgetEnforcement)) {
  return res.status(400).json({ error: "budgetEnforcement must be off|warn|block" });
}
```

- [ ] **Step 2: Add GET /api/projects/:id/costs**

Append to the same file:

```ts
import {
  getProjectMonthBreakdown,
  getProjectDailySpend,
  currentMonthStartUTC,
} from "../services/taskService.js";
import type { ProjectCosts } from "../types/index.js";

router.get("/:id/costs", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const monthStart = currentMonthStartUTC();
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

  const { totalUsd, rows } = getProjectMonthBreakdown(
    project.id,
    monthStart,
    project.defaultModel ?? null,
  );
  const daily = getProjectDailySpend(project.id, 30, project.defaultModel ?? null);

  const payload: ProjectCosts = {
    period: { start: monthStart.toISOString(), end: monthEnd.toISOString() },
    totalUsd,
    budgetUsd: project.monthlyBudgetUsd ?? null,
    enforcement: project.budgetEnforcement ?? "warn",
    defaultModel: project.defaultModel ?? null,
    breakdown: rows.map((r) => ({
      taskId: r.taskId,
      displayId: r.displayId,
      title: r.title,
      model: r.model,
      tokens: r.tokens,
      costUsd: r.costUsd,
      completedAt: r.completedAt,
    })),
    daily,
  };
  res.json(payload);
});
```

(Use the file's existing router/import style — `router.get` vs `app.get` — adjust to match.)

- [ ] **Step 3: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Manual smoke test**

```bash
cd core && npm run dev
# In another shell:
curl -s http://localhost:3001/api/projects/<some-real-id>/costs | jq .
```

Expected: a JSON object with `period`, `totalUsd: 0` (or accurate), `breakdown: []`, `daily: [...30 entries]`.

- [ ] **Step 5: Commit**

```bash
git add core/src/routes/projects.ts
git commit -m "feat(cost): PATCH budget fields + GET /api/projects/:id/costs"
```

---

### Task 9: Task route — model on POST/PATCH, DOING block check

**Files:**
- Modify: `core/src/routes/tasks.ts`

- [ ] **Step 1: Accept `model` in POST**

Find the POST handler that creates tasks. Add `model` to the body destructure. Validate against `SUPPORTED_MODELS`:

```ts
import { SUPPORTED_MODELS } from "../services/pricingService.js";

if (body.model !== undefined && body.model !== null &&
    !SUPPORTED_MODELS.includes(body.model)) {
  return res.status(400).json({ error: `model must be one of ${SUPPORTED_MODELS.join(", ")}` });
}
```

Pass `model` through to `createTask({ ..., model: body.model ?? null })`.

- [ ] **Step 2: Accept `model` in PATCH**

Mirror the same check in the PATCH handler. Allow `null` to clear it.

- [ ] **Step 3: Block-on-budget guard for DOING transitions**

In the PATCH handler, just before the call that flips status, when the requested status is `doing`, run:

```ts
import {
  getProjectMonthBreakdown,
  currentMonthStartUTC,
} from "../services/taskService.js";

// inside the PATCH handler, after loading `task` and before the status update:
if (body.status === "doing") {
  const project = getProject(task.projectId);
  if (project && project.budgetEnforcement === "block" && project.monthlyBudgetUsd != null) {
    const { totalUsd } = getProjectMonthBreakdown(
      project.id,
      currentMonthStartUTC(),
      project.defaultModel ?? null,
    );
    if (totalUsd >= project.monthlyBudgetUsd) {
      return res.status(409).json({
        error: "budget_exceeded",
        currentUsd: totalUsd,
        budgetUsd: project.monthlyBudgetUsd,
      });
    }
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
cd core && npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add core/src/routes/tasks.ts
git commit -m "feat(cost): accept model on tasks + block DOING transition over budget"
```

---

### Task 10: i18n strings for the Costs tab

**Files:**
- Modify: `gui/src/lib/i18n/types.ts`
- Modify: `gui/src/lib/i18n/en.ts`
- Modify: `gui/src/lib/i18n/tr.ts`

- [ ] **Step 1: Add the namespace shape to `types.ts`**

Append to the `Translations` interface:

```ts
costsTab: {
  tabLabel: string;
  thisMonth: string;
  noBudget: string;
  setBudget: string;
  budgetLabel: string;
  enforcementLabel: string;
  enforcementOff: string;
  enforcementWarn: string;
  enforcementBlock: string;
  defaultModelLabel: string;
  useProjectDefault: string;
  modelOpus: string;
  modelSonnet: string;
  modelHaiku: string;
  breakdownTitle: string;
  breakdownEmpty: string;
  colDisplayId: string;
  colTitle: string;
  colModel: string;
  colTokens: string;
  colCost: string;
  colDate: string;
  budgetExceededToast: string;
  budgetWarnToast: string;
  saveSettings: string;
};
```

If the `addTaskModal` namespace exists, add to it:

```ts
modelDropdownLabel: string;
modelUseDefault: string;
```

- [ ] **Step 2: Fill English strings**

In `gui/src/lib/i18n/en.ts`, add a `costsTab` block:

```ts
costsTab: {
  tabLabel: "Costs",
  thisMonth: "This month",
  noBudget: "No budget set",
  setBudget: "Set budget",
  budgetLabel: "Monthly budget (USD)",
  enforcementLabel: "Enforcement",
  enforcementOff: "Off",
  enforcementWarn: "Warn",
  enforcementBlock: "Block",
  defaultModelLabel: "Default model",
  useProjectDefault: "Use project default",
  modelOpus: "Opus 4.7",
  modelSonnet: "Sonnet 4.6",
  modelHaiku: "Haiku 4.5",
  breakdownTitle: "Tasks this month",
  breakdownEmpty: "No tasks ran this month yet.",
  colDisplayId: "ID",
  colTitle: "Title",
  colModel: "Model",
  colTokens: "Tokens",
  colCost: "Cost",
  colDate: "Date",
  budgetExceededToast: "Budget exceeded — task blocked.",
  budgetWarnToast: "Budget approaching limit.",
  saveSettings: "Save",
},
```

And in the existing `addTaskModal` block:

```ts
modelDropdownLabel: "Model",
modelUseDefault: "Use project default",
```

- [ ] **Step 3: Fill Turkish strings**

In `gui/src/lib/i18n/tr.ts`:

```ts
costsTab: {
  tabLabel: "Maliyet",
  thisMonth: "Bu ay",
  noBudget: "Bütçe ayarlanmamış",
  setBudget: "Bütçe belirle",
  budgetLabel: "Aylık bütçe (USD)",
  enforcementLabel: "Uygulama",
  enforcementOff: "Kapalı",
  enforcementWarn: "Uyar",
  enforcementBlock: "Engelle",
  defaultModelLabel: "Varsayılan model",
  useProjectDefault: "Proje varsayılanını kullan",
  modelOpus: "Opus 4.7",
  modelSonnet: "Sonnet 4.6",
  modelHaiku: "Haiku 4.5",
  breakdownTitle: "Bu ayın görevleri",
  breakdownEmpty: "Bu ay henüz hiç görev koşulmadı.",
  colDisplayId: "ID",
  colTitle: "Başlık",
  colModel: "Model",
  colTokens: "Token",
  colCost: "Maliyet",
  colDate: "Tarih",
  budgetExceededToast: "Bütçe aşıldı — görev engellendi.",
  budgetWarnToast: "Bütçe limite yaklaşıyor.",
  saveSettings: "Kaydet",
},
```

And in `addTaskModal`:

```ts
modelDropdownLabel: "Model",
modelUseDefault: "Proje varsayılanını kullan",
```

- [ ] **Step 4: Typecheck**

```bash
cd gui && pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add gui/src/lib/i18n/
git commit -m "feat(cost): i18n strings for costs tab + model dropdown"
```

---

### Task 11: API client wrappers

**Files:**
- Modify: `gui/src/lib/api.ts`

- [ ] **Step 1: Add typed wrappers**

Append to `gui/src/lib/api.ts`. Mirror the existing `api.*` style:

```ts
export interface ProjectCosts {
  period: { start: string; end: string };
  totalUsd: number;
  budgetUsd: number | null;
  enforcement: "off" | "warn" | "block";
  defaultModel: string | null;
  breakdown: Array<{
    taskId: string;
    displayId: string | null;
    title: string;
    model: string;
    tokens: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    };
    costUsd: number;
    completedAt: string;
  }>;
  daily: Array<{ date: string; costUsd: number }>;
}

// Add to the exported `api` object:
//   getProjectCosts, updateProjectBudget
```

In whatever shape the existing `api` object uses (likely `export const api = { ... }`), add:

```ts
async getProjectCosts(projectId: string): Promise<ProjectCosts> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/costs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
},
async updateProjectBudget(
  projectId: string,
  body: {
    monthlyBudgetUsd?: number | null;
    defaultModel?: string | null;
    budgetEnforcement?: "off" | "warn" | "block";
  },
): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
},
```

(Use whatever the file's existing `BASE` / fetch wrapper convention is — look at neighbouring methods.)

- [ ] **Step 2: Typecheck**

```bash
cd gui && pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add gui/src/lib/api.ts
git commit -m "feat(cost): api client wrappers for /costs + budget patch"
```

---

### Task 12: Board store — costs cache + cost_update handler

**Files:**
- Modify: `gui/src/store/boardStore.ts`
- Modify: `gui/src/hooks/useAgentSocket.ts`

- [ ] **Step 1: Add costs slice to the store**

In `boardStore.ts`, extend the state interface:

```ts
costsByProject: Record<string, { totalUsd: number; budgetUsd: number | null; percentage: number | null }>;
setProjectCostSummary: (
  projectId: string,
  data: { totalUsd: number; budgetUsd: number | null; percentage: number | null },
) => void;
```

In the `create<...>(set => ({ ... }))` body:

```ts
costsByProject: {},
setProjectCostSummary: (projectId, data) =>
  set((s) => ({ costsByProject: { ...s.costsByProject, [projectId]: data } })),
```

- [ ] **Step 2: Wire the WS event in `useAgentSocket.ts`**

Find the switch over `msg.type`. Add a case:

```ts
case "cost_update":
  useBoardStore.getState().setProjectCostSummary(msg.projectId, msg.payload);
  break;
```

- [ ] **Step 3: Typecheck**

```bash
cd gui && pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add gui/src/store/boardStore.ts gui/src/hooks/useAgentSocket.ts
git commit -m "feat(cost): zustand slice + WS handler for cost_update"
```

---

### Task 13: AddTaskModal — model dropdown

**Files:**
- Modify: `gui/src/components/Modals/AddTaskModal.tsx`

- [ ] **Step 1: Add the dropdown**

Find the form. Add a controlled `<select>` for model. Mirror the style of existing inputs (label + field). Local state:

```tsx
const [model, setModel] = useState<string>(""); // "" means use project default

// in the form:
<label className="block text-xs uppercase tracking-wide text-[var(--text-muted)]">
  {t.addTaskModal.modelDropdownLabel}
</label>
<select
  value={model}
  onChange={(e) => setModel(e.target.value)}
  className="..." /* match existing input classes */
>
  <option value="">{t.addTaskModal.modelUseDefault}</option>
  <option value="claude-opus-4-7">{t.costsTab.modelOpus}</option>
  <option value="claude-sonnet-4-6">{t.costsTab.modelSonnet}</option>
  <option value="claude-haiku-4-5">{t.costsTab.modelHaiku}</option>
</select>
```

Pass `model: model || undefined` (or `null`) to whatever `api.createTask` call submits the form.

- [ ] **Step 2: Typecheck + lint**

```bash
cd gui && pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add gui/src/components/Modals/AddTaskModal.tsx
git commit -m "feat(cost): per-task model dropdown in AddTaskModal"
```

---

### Task 14: CostsTab component

**Files:**
- Create: `gui/src/components/Modals/CostsTab.tsx`

- [ ] **Step 1: Implement the component**

Create the file with the full content below. Style classes use the existing `var(--bg-base)`, `var(--text-primary)`, etc. tokens already used across the project — match the visual language of `ClaudeConfigTab`.

```tsx
"use client";

import { useEffect, useState } from "react";
import { api, type ProjectCosts } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";

interface Props {
  projectId: string;
}

export function CostsTab({ projectId }: Props) {
  const t = useTranslation();
  const live = useBoardStore((s) => s.costsByProject[projectId]);
  const [data, setData] = useState<ProjectCosts | null>(null);
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState<string>("");
  const [enforcement, setEnforcement] = useState<"off" | "warn" | "block">("warn");
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getProjectCosts(projectId).then((d) => {
      if (cancelled) return;
      setData(d);
      setBudget(d.budgetUsd != null ? String(d.budgetUsd) : "");
      setEnforcement(d.enforcement);
      setDefaultModel(d.defaultModel ?? "");
    });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!data) return <div className="p-4 text-[var(--text-muted)]">…</div>;

  const totalUsd = live?.totalUsd ?? data.totalUsd;
  const budgetUsd = live?.budgetUsd ?? data.budgetUsd;
  const pct = budgetUsd && budgetUsd > 0 ? Math.min(100, (totalUsd / budgetUsd) * 100) : null;
  const barColor = pct == null
    ? "bg-[var(--text-muted)]"
    : pct >= 100 ? "bg-red-500"
    : pct >= 80  ? "bg-amber-500"
    : "bg-[var(--accent)]";

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const parsed = budget.trim() === "" ? null : Number(budget);
      if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
        throw new Error("invalid budget");
      }
      await api.updateProjectBudget(projectId, {
        monthlyBudgetUsd: parsed,
        budgetEnforcement: enforcement,
        defaultModel: defaultModel === "" ? null : defaultModel,
      });
      const fresh = await api.getProjectCosts(projectId);
      setData(fresh);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="border border-[var(--border)] p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              {t.costsTab.thisMonth}
            </div>
            <div className="font-mono text-3xl tabular-nums">
              ${totalUsd.toFixed(2)}
              <span className="text-[var(--text-muted)] text-base">
                {budgetUsd != null ? ` / $${budgetUsd.toFixed(2)}` : ""}
              </span>
            </div>
          </div>
          <button onClick={() => setEditing((v) => !v)} className="text-xs underline">
            {editing ? "×" : t.costsTab.setBudget}
          </button>
        </div>

        {pct != null && (
          <div className="mt-3 h-2 w-full bg-[var(--bg-surface)]">
            <div className={`h-2 ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}

        {editing && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              {t.costsTab.budgetLabel}
              <input
                type="number"
                min="0"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t.costsTab.enforcementLabel}
              <select
                value={enforcement}
                onChange={(e) => setEnforcement(e.target.value as "off" | "warn" | "block")}
                className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1"
              >
                <option value="off">{t.costsTab.enforcementOff}</option>
                <option value="warn">{t.costsTab.enforcementWarn}</option>
                <option value="block">{t.costsTab.enforcementBlock}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t.costsTab.defaultModelLabel}
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1"
              >
                <option value="">{t.costsTab.useProjectDefault}</option>
                <option value="claude-opus-4-7">{t.costsTab.modelOpus}</option>
                <option value="claude-sonnet-4-6">{t.costsTab.modelSonnet}</option>
                <option value="claude-haiku-4-5">{t.costsTab.modelHaiku}</option>
              </select>
            </label>
            <div className="sm:col-span-3">
              <button
                onClick={onSave}
                disabled={saving}
                className="bg-[var(--text-primary)] px-3 py-1 text-[var(--bg-base)] disabled:opacity-50"
              >
                {t.costsTab.saveSettings}
              </button>
              {err && <span className="ml-3 text-red-500 text-xs">{err}</span>}
            </div>
          </div>
        )}
      </section>

      <Sparkline daily={data.daily} />

      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">
          {t.costsTab.breakdownTitle}
        </div>
        {data.breakdown.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">{t.costsTab.breakdownEmpty}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="py-1">{t.costsTab.colDisplayId}</th>
                <th>{t.costsTab.colTitle}</th>
                <th>{t.costsTab.colModel}</th>
                <th className="text-right">{t.costsTab.colTokens}</th>
                <th className="text-right">{t.costsTab.colCost}</th>
                <th>{t.costsTab.colDate}</th>
              </tr>
            </thead>
            <tbody>
              {data.breakdown.map((r) => (
                <tr key={r.taskId} className="border-t border-[var(--border)]">
                  <td className="py-1 font-mono text-xs">{r.displayId ?? "—"}</td>
                  <td className="truncate max-w-[18ch]">{r.title}</td>
                  <td className="font-mono text-xs">{r.model}</td>
                  <td className="text-right tabular-nums">
                    {(r.tokens.inputTokens + r.tokens.outputTokens + r.tokens.cacheReadTokens + r.tokens.cacheWriteTokens).toLocaleString()}
                  </td>
                  <td className="text-right font-mono tabular-nums">${r.costUsd.toFixed(4)}</td>
                  <td className="text-xs">{r.completedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Sparkline({ daily }: { daily: Array<{ date: string; costUsd: number }> }) {
  const max = Math.max(0.0001, ...daily.map((d) => d.costUsd));
  const w = 600;
  const h = 60;
  const step = w / Math.max(1, daily.length - 1);
  const points = daily
    .map((d, i) => `${i * step},${h - (d.costUsd / max) * h}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16 text-[var(--accent)]">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
cd gui && pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add gui/src/components/Modals/CostsTab.tsx
git commit -m "feat(cost): CostsTab component (summary + sparkline + breakdown + settings)"
```

---

### Task 15: ProjectDetailDrawer — wire the Costs tab

**Files:**
- Modify: `gui/src/components/Modals/ProjectDetailDrawer.tsx`

- [ ] **Step 1: Extend the activeTab union**

Change:

```ts
const [activeTab, setActiveTab] = useState<"overview" | "claude">("overview");
```

To:

```ts
const [activeTab, setActiveTab] = useState<"overview" | "claude" | "costs">("overview");
```

- [ ] **Step 2: Add the tab to the tab list**

Find the array literal currently containing `{ key: "claude", label: t.claudeConfig.tabLabel }` (around line 245). Append:

```ts
{ key: "costs", label: t.costsTab.tabLabel },
```

- [ ] **Step 3: Render the Costs tab content**

Below the line `{activeTab === "claude" ? ( ... ) : null}`:

```tsx
{activeTab === "costs" ? (
  <CostsTab projectId={project.id} />
) : null}
```

Add the import at the top:

```ts
import { CostsTab } from "@/components/Modals/CostsTab";
```

- [ ] **Step 4: Typecheck + lint**

```bash
cd gui && pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 5: Manual smoke**

Start both services. Open a project drawer. Click the "Costs" tab. Confirm the summary card renders ($0.00, no budget). Click "Set budget", enter 50, save. Reload — value persisted.

- [ ] **Step 6: Commit**

```bash
git add gui/src/components/Modals/ProjectDetailDrawer.tsx
git commit -m "feat(cost): mount CostsTab as third drawer tab"
```

---

### Task 16: Header cost badge

**Files:**
- Modify: `gui/src/components/Layout/Header.tsx`

- [ ] **Step 1: Add the badge**

Subscribe to `useBoardStore((s) => s.costsByProject)`, plus the active project id (already in the store). Render a small badge:

```tsx
const costsByProject = useBoardStore((s) => s.costsByProject);
const activeProjectId = useBoardStore((s) => s.activeProjectId);
const active = activeProjectId ? costsByProject[activeProjectId] : undefined;

// inside the header bar, near the WS status:
{active && (
  <button
    type="button"
    onClick={() => useBoardStore.getState().openProjectDrawerOnTab?.("costs")}
    title="this month"
    className="font-mono text-xs tabular-nums text-[var(--text-muted)] hover:text-[var(--text-primary)]"
  >
    ${active.totalUsd.toFixed(2)}
    {active.budgetUsd != null ? ` / $${active.budgetUsd.toFixed(0)}` : ""}
  </button>
)}
```

If `openProjectDrawerOnTab` doesn't yet exist in the store, leave the click as a no-op (`onClick={() => {}}`) — the badge alone covers the must-have. A future task can add deep-link to the Costs tab.

- [ ] **Step 2: Typecheck + lint**

```bash
cd gui && pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add gui/src/components/Layout/Header.tsx
git commit -m "feat(cost): header badge with this-month spend"
```

---

### Task 17: Manual end-to-end verification

This is a verification gate, not a code task. Run through it before declaring the feature done.

- [ ] **Step 1: Reset and start both services**

```bash
cd core && npm run dev
# in another shell:
cd gui && pnpm dev
```

- [ ] **Step 2: Configure a budget**

Open a project drawer → Costs tab → Set budget = `0.10`, enforcement = `block`, default model = Sonnet. Save. Reload — values persist.

- [ ] **Step 3: Run a small task, observe live update**

Add a task, drag to DOING. After it completes, watch the summary card update (via `cost_update` WS event) without a page refresh. The breakdown table should now have one row.

- [ ] **Step 4: Trigger the block**

Drag a second task to DOING. The card should snap back to TODO and a red toast should display `budget_exceeded`. Confirm the API returned 409 in the network tab.

- [ ] **Step 5: Switch enforcement to `warn`**

Save settings with enforcement = `warn`. Drag the same card to DOING. It should now run; observe a yellow toast.

- [ ] **Step 6: Per-task model override**

Open AddTask → pick `Haiku 4.5`. After completion, the breakdown row should show `claude-haiku-4-5` and a notably lower cost than a Sonnet/Opus run.

- [ ] **Step 7: Header badge sanity**

Header should show `$X.XX / $0` (or `/ $0.10` matching set budget) and update without refresh.

- [ ] **Step 8: Typecheck both packages one final time**

```bash
cd core && npm run typecheck
cd ../gui && pnpm typecheck && pnpm lint
```

Expected: clean.

---

## Done

Feature is complete when all tasks are checked and Task 17 verification passes. Open a PR with title:

```
feat: cost center mvp — per-project budgets, model override, spend breakdown
```

Body should reference the spec at `docs/superpowers/specs/2026-05-01-cost-center-mvp-design.md`.
