# Plan: Cost Guardrails (Phase 5)

## Summary
Add per-task USD budget enforcement so unattended graph runs never exceed a configured spending limit. The graphRunner checks cumulative cost after each node's token update; when the budget is hit it aborts with a distinct error message and broadcasts a `budget_exceeded` WS event. The task drawer gains a budget progress bar, and project settings gain a `budgetUsd` override field.

## User Story
As a ClauFlow user, I want to set a USD budget on a task/project so that an unattended multi-node run pauses at the right point with partial work preserved instead of running unbounded.

## Problem → Solution
No spending limit exists → per-project `budgetUsd` (default from server constant) + in-flight budget check inside `onClaudeResult` → `controller.abort()` + `budget_exceeded` WS event + progress bar in task drawer.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/orchestration-ci-observability.prd.md`
- **PRD Phase**: Phase 5 — Cost Guardrails
- **Estimated Files**: 13

---

## UX Design

### Before
```
Task drawer footer: "12,450 tokens · ~$0.05"
No budget concept — run until done or error.
```

### After
```
Task drawer — details tab:
┌────────────────────────────────────────┐
│ Budget                                 │
│ $0.05 / $2.00  ████░░░░░░░░  2.5%     │
│ (bar turns red at 90%, red+label when  │
│  exceeded)                             │
└────────────────────────────────────────┘

Project settings — Claude Config tab:
  Task budget (USD)  [ 2.00 ]  (blank = $2.00 default)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Task drawer | cost pill only | budget progress bar in details tab | existing `costPill` stays |
| Project settings | no budget field | `budgetUsd` number input | Claude Config tab |
| Task error toast | generic error | "Budget exceeded: $X.XX / $Y.YY" | distinct message |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/agents/graphRunner.ts` | 380–430 | `onClaudeResult` — primary insertion point |
| P0 | `core/src/services/taskService.ts` | 1260–1310 | `updateTaskUsage` — returns refreshed Task |
| P0 | `core/src/services/pricingService.ts` | 1–60 | `calculateCostUsd`, `DEFAULT_MODEL` |
| P0 | `core/src/types/index.ts` | 30–55, 137–206 | `Task`, `Project`, `WsMessage` union |
| P1 | `core/src/services/wsService.ts` | 148–200 | `broadcastCiIterationStarted` pattern |
| P1 | `core/src/agents/executor.ts` | 55–70, 360–395 | `abort()` + legacy `onClaudeResult` |
| P1 | `core/src/routes/projects.ts` | 49–60, 217–225 | Zod schema pattern |
| P1 | `gui/src/hooks/useAgentSocket.ts` | 170–195 | `ci_iteration_started` case pattern |
| P2 | `gui/src/components/Card/TaskDetailDrawer.tsx` | 200–215 | `costPill` — insert budget bar nearby |
| P2 | `gui/src/components/Modals/ProjectDetailDrawer.tsx` | 17–35, 326–395 | `DraftState` + `Field` pattern |
| P2 | `gui/src/store/boardStore.ts` | 36, 100, 127, 453 | `ciIterations` state pattern |
| P2 | `gui/src/types/index.ts` | mirror of core types | Frontend WsMessage + Task + Project |

## External Documentation
N/A — feature uses established internal patterns.

---

## Patterns to Mirror

### IDEMPOTENT_MIGRATION
```ts
// SOURCE: core/src/services/taskService.ts:130-165
{
  const cols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
  const ddl: Record<string, string> = {
    budgetUsd: `ALTER TABLE projects ADD COLUMN budgetUsd REAL`,
  };
  for (const name of Object.keys(ddl)) {
    if (!cols.some((c) => c.name === name)) db.exec(ddl[name]!);
  }
}
```

### BROADCAST_FUNCTION
```ts
// SOURCE: core/src/services/wsService.ts:175-190
export function broadcastCiIterationStarted(
  taskId: string,
  iteration: number,
  maxIterations: number,
): void {
  broadcast({
    type: "ci_iteration_started",
    taskId,
    payload: { iteration, maxIterations },
  });
}
// Mirror: broadcastBudgetExceeded(taskId, spentUsd, budgetUsd)
```

### WS_MESSAGE_UNION
```ts
// SOURCE: core/src/types/index.ts:137+
| {
    type: "ci_iteration_started";
    taskId: string;
    payload: { iteration: number; maxIterations: number };
  }
// Mirror: add budget_exceeded variant with { spentUsd: number; budgetUsd: number }
```

### ABORT_PATTERN
```ts
// SOURCE: core/src/agents/executor.ts:59-65
const RUNNING = new Map<string, AbortController>();
export function abort(taskId: string): boolean {
  const ctrl = RUNNING.get(taskId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}
// Inside onClaudeResult: call controller.abort() after broadcast
```

### ON_CLAUDE_RESULT_HOOK
```ts
// SOURCE: core/src/agents/graphRunner.ts:392-403
const onClaudeResult = (raw: unknown): void => {
  const usage = parseUsageFromResult(raw);
  if (!usage) return;
  cumulativeUsage = usage;
  updateTaskUsage(task.id, usage)
    .then((t) => {
      if (t) broadcastTaskUpdated(t);
    })
    .catch((e) => {
      console.error(`[graphRunner] updateTaskUsage failed:`, e);
    });
};
// Budget check goes inside the .then((t) => { ... }) block
```

### ZOD_ROUTE_SCHEMA
```ts
// SOURCE: core/src/routes/projects.ts:217-225
const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  aiPrompt: z.string().optional(),
  // Mirror: budgetUsd: z.number().positive().nullable().optional()
});
```

### USEAGENTSOCKET_CASE
```ts
// SOURCE: gui/src/hooks/useAgentSocket.ts:177-183
case "ci_iteration_started": {
  const m = msg as Extract<WsMessage, { type: "ci_iteration_started" }>;
  setCiIteration(m.taskId, m.payload.iteration, m.payload.maxIterations);
  break;
}
// Mirror: case "budget_exceeded" → setBudgetExceeded(m.taskId, m.payload)
```

### STORE_STATE_SLICE
```ts
// SOURCE: gui/src/store/boardStore.ts:36,100,127,453
ciIterations: Record<string, { iteration: number; maxIterations: number }>;
// state init: ciIterations: {}
// action: setCiIteration: (taskId, iteration, maxIterations) => set(...)
// Mirror: budgetExceeded: Record<string, { spentUsd: number; budgetUsd: number }>
```

### DRAFT_STATE_FIELD
```ts
// SOURCE: gui/src/components/Modals/ProjectDetailDrawer.tsx:17-35
interface DraftState {
  name: string;
  description: string;
  aiPrompt: string;
  repoPath: string;
  defaultBranch: string;
  // add: budgetUsd: string  (string for input value, parse on save)
}
// Field JSX pattern: <Field label="..."><input type="number" .../></Field>
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/services/pricingService.ts` | UPDATE | Add `DEFAULT_TASK_BUDGET_USD = 2.0` constant |
| `core/src/services/taskService.ts` | UPDATE | Idempotent `budgetUsd` column on `projects` + `tasks`; expose `getTaskSpendUsd` helper |
| `core/src/types/index.ts` | UPDATE | `Project.budgetUsd?`, `Task` no change (spend derived), `WsMessage` += `budget_exceeded` |
| `core/src/services/wsService.ts` | UPDATE | Add `broadcastBudgetExceeded(taskId, spentUsd, budgetUsd)` |
| `core/src/agents/graphRunner.ts` | UPDATE | Budget check in `onClaudeResult` `.then()` block; resolve effective budget from project |
| `core/src/agents/executor.ts` | UPDATE | Same budget check in legacy `onClaudeResult` path |
| `core/src/routes/projects.ts` | UPDATE | Add `budgetUsd` to `createProjectSchema` + `updateProjectSchema`; pass to service |
| `gui/src/types/index.ts` | UPDATE | Mirror `Project.budgetUsd?` + `budget_exceeded` WsMessage variant |
| `gui/src/lib/api.ts` | UPDATE | Add `budgetUsd` to `CreateProjectInput` / `ProjectPatch` |
| `gui/src/store/boardStore.ts` | UPDATE | Add `budgetExceeded` state slice + `setBudgetExceeded` action |
| `gui/src/hooks/useAgentSocket.ts` | UPDATE | Add `budget_exceeded` case → `setBudgetExceeded` + toast |
| `gui/src/components/Card/TaskDetailDrawer.tsx` | UPDATE | Budget progress bar section in details tab |
| `gui/src/components/Modals/ProjectDetailDrawer.tsx` | UPDATE | `budgetUsd` input in `DraftState` + `Field` UI |

## NOT Building
- Per-task budget override UI (per-project budget is enough for v1; per-task row exists in schema as nullable)
- Pause/resume mid-node (abort = SIGTERM; user retries via existing retry flow)
- Anthropic billing reconciliation benchmark (manual validation step, not a UI feature)
- Budget history / spend-over-time chart (Phase 6 Fleet Dashboard)

---

## Step-by-Step Tasks

### Task 1: Add DEFAULT_TASK_BUDGET_USD to pricingService
- **ACTION**: Add constant after `DEFAULT_MODEL`
- **IMPLEMENT**: `export const DEFAULT_TASK_BUDGET_USD = 2.0;`
- **MIRROR**: `DEFAULT_MODEL` constant style
- **IMPORTS**: none
- **GOTCHA**: Keep it exported — graphRunner + executor import it
- **VALIDATE**: `npm run typecheck` in `core/`

### Task 2: DB migrations — budgetUsd columns
- **ACTION**: Add idempotent `ALTER TABLE` for `projects.budgetUsd` and `tasks.budgetUsd`
- **IMPLEMENT**:
```ts
// In taskService.ts startup block, after existing migrations:
{
  const projectCols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
  if (!projectCols.some((c) => c.name === "budgetUsd"))
    db.exec(`ALTER TABLE projects ADD COLUMN budgetUsd REAL`);
}
{
  const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  if (!taskCols.some((c) => c.name === "budgetUsd"))
    db.exec(`ALTER TABLE tasks ADD COLUMN budgetUsd REAL`);
}
```
- **MIRROR**: `IDEMPOTENT_MIGRATION` pattern
- **IMPORTS**: none (uses existing `db`)
- **GOTCHA**: `tasks.budgetUsd` is nullable — means "inherit from project"
- **VALIDATE**: Start server, check `PRAGMA table_info(projects)` includes `budgetUsd`

### Task 3: Expose budgetUsd in taskService CRUD
- **ACTION**: Add `budgetUsd` to `createProject` / `updateProject` / `rowToProject`; add `getTaskEffectiveBudget(taskId)` helper
- **IMPLEMENT**:
  - `rowToProject`: add `budgetUsd: row.budgetUsd ?? null`
  - `createProject` + `updateProject`: accept and persist `budgetUsd`
  - New helper:
```ts
export function getTaskEffectiveBudget(taskId: string): number | null {
  const task = stmtGetTask.get(taskId) as TaskRow | undefined;
  if (!task) return null;
  if (task.budgetUsd != null) return task.budgetUsd;
  const project = stmtGetProject.get(task.projectId) as ProjectRow | undefined;
  if (!project) return null;
  return project.budgetUsd ?? DEFAULT_TASK_BUDGET_USD;
}
```
- **MIRROR**: `updateTaskUsage` pattern for DB access
- **IMPORTS**: `DEFAULT_TASK_BUDGET_USD` from `pricingService.js`
- **GOTCHA**: `DEFAULT_TASK_BUDGET_USD` is the fallback when both task and project `budgetUsd` are null
- **VALIDATE**: Unit-test helper with in-memory DB scenario

### Task 4: Update core types — Project + WsMessage
- **ACTION**: Add `budgetUsd?: number | null` to `Project`; add `budget_exceeded` to `WsMessage`
- **IMPLEMENT**:
```ts
// Project interface — add field:
budgetUsd?: number | null;

// WsMessage union — add variant:
| {
    type: "budget_exceeded";
    taskId: string;
    payload: { spentUsd: number; budgetUsd: number };
  }
```
- **MIRROR**: `WS_MESSAGE_UNION` pattern
- **IMPORTS**: none
- **GOTCHA**: `Task` interface does NOT get `budgetUsd` — spend is derived from `usage` + `pricingService`
- **VALIDATE**: `npm run typecheck`

### Task 5: Add broadcastBudgetExceeded to wsService
- **ACTION**: Add new broadcast function
- **IMPLEMENT**:
```ts
export function broadcastBudgetExceeded(
  taskId: string,
  spentUsd: number,
  budgetUsd: number,
): void {
  broadcast({ type: "budget_exceeded", taskId, payload: { spentUsd, budgetUsd } });
}
```
- **MIRROR**: `BROADCAST_FUNCTION` pattern (`broadcastCiIterationStarted`)
- **IMPORTS**: `WsMessage` already imported
- **GOTCHA**: none
- **VALIDATE**: TypeScript will catch WsMessage mismatch if Task 4 types are wrong

### Task 6: Budget check in graphRunner.ts
- **ACTION**: Inject budget check inside `onClaudeResult` → `.then()` block, after `broadcastTaskUpdated`
- **IMPLEMENT**:
```ts
// At top of runNodeInner (or runGraph), resolve once:
const effectiveBudget = getTaskEffectiveBudget(task.id);

// Inside onClaudeResult .then((t) => { ... }):
if (t && effectiveBudget != null) {
  const spentUsd = calculateCostUsd(
    {
      inputTokens: t.inputTokens ?? 0,
      outputTokens: t.outputTokens ?? 0,
      cacheReadTokens: t.cacheReadTokens ?? 0,
      cacheWriteTokens: t.cacheWriteTokens ?? 0,
    },
    t.agent?.model ?? DEFAULT_MODEL,
  );
  if (spentUsd >= effectiveBudget) {
    broadcastBudgetExceeded(task.id, spentUsd, effectiveBudget);
    controller.abort();
  }
}
```
- **MIRROR**: `ON_CLAUDE_RESULT_HOOK` + `ABORT_PATTERN`
- **IMPORTS**: `getTaskEffectiveBudget`, `calculateCostUsd`, `broadcastBudgetExceeded`, `DEFAULT_MODEL`
- **GOTCHA**: `calculateCostUsd` uses task-level cumulative tokens (cross-node total) — correct because `updateTaskUsage` increments task-level counters. Use task model fallback `DEFAULT_MODEL` since task-level model is not stored (per-node model is in `task_node_runs`).
- **VALIDATE**: Start server, run a task with `budgetUsd = 0.0001` on project → should abort immediately after first token update

### Task 7: Budget check in executor.ts (legacy path)
- **ACTION**: Same budget check in `onClaudeResult` inside `executor.ts`
- **IMPLEMENT**: Mirror Task 6 exactly — resolve `effectiveBudget` before the `runClaude` call, check inside `.then()` block
- **MIRROR**: Same as Task 6
- **IMPORTS**: same imports
- **GOTCHA**: Legacy path uses `task.agent.model` or falls back to `DEFAULT_MODEL`
- **VALIDATE**: Single-node task (no graph) with tiny budget → aborts

### Task 8: Project route — accept budgetUsd
- **ACTION**: Add `budgetUsd` to Zod schemas and pass to service
- **IMPLEMENT**:
```ts
// createProjectSchema:
budgetUsd: z.number().positive().nullable().optional(),

// updateProjectSchema:
budgetUsd: z.number().positive().nullable().optional(),

// In route handler, pass body.budgetUsd to createProject / updateProject
```
- **MIRROR**: `ZOD_ROUTE_SCHEMA` + `maxTasks` field pattern (line 59)
- **IMPORTS**: none (z already imported)
- **GOTCHA**: `nullable().optional()` allows explicit `null` (reset to default) and omission
- **VALIDATE**: `PATCH /api/projects/:id` with `{ budgetUsd: 5.0 }` → project row updated

### Task 9: Mirror types in gui
- **ACTION**: Update `gui/src/types/index.ts` — `Project.budgetUsd` + `budget_exceeded` WsMessage
- **IMPLEMENT**: Exact mirror of Task 4 changes
- **MIRROR**: existing gui types follow core types 1:1
- **IMPORTS**: none
- **GOTCHA**: gui types are a copy, not imported from core — must update both
- **VALIDATE**: `pnpm typecheck` in `gui/`

### Task 10: Update gui/src/lib/api.ts
- **ACTION**: Add `budgetUsd` to `CreateProjectInput` and `ProjectPatch` (or equivalent)
- **IMPLEMENT**: Add `budgetUsd?: number | null` to the relevant input types and pass through in `api.updateProject`
- **MIRROR**: existing optional fields pattern in `api.ts`
- **VALIDATE**: `pnpm typecheck`

### Task 11: boardStore — budgetExceeded state slice
- **ACTION**: Add `budgetExceeded` map + `setBudgetExceeded` action
- **IMPLEMENT**:
```ts
// State interface:
budgetExceeded: Record<string, { spentUsd: number; budgetUsd: number }>;

// Init:
budgetExceeded: {},

// Action:
setBudgetExceeded: (taskId, payload) =>
  set((state) => ({
    budgetExceeded: { ...state.budgetExceeded, [taskId]: payload },
  })),
```
- **MIRROR**: `STORE_STATE_SLICE` (`ciIterations` pattern)
- **VALIDATE**: `pnpm typecheck`

### Task 12: useAgentSocket — budget_exceeded case
- **ACTION**: Add case to the WS switch
- **IMPLEMENT**:
```ts
case "budget_exceeded": {
  const m = msg as Extract<WsMessage, { type: "budget_exceeded" }>;
  setBudgetExceeded(m.taskId, m.payload);
  // toast — reuse existing toast pattern from other error cases
  break;
}
```
- **MIRROR**: `USEAGENTSOCKET_CASE` pattern
- **IMPORTS**: `setBudgetExceeded` from `useBoardStore`
- **GOTCHA**: Toast message: `Budget exceeded: $${m.payload.spentUsd.toFixed(4)} / $${m.payload.budgetUsd.toFixed(2)}`
- **VALIDATE**: WS message triggers store update + toast in browser

### Task 13: TaskDetailDrawer — budget progress bar
- **ACTION**: Add budget section in details tab, after `costPill` block
- **IMPLEMENT**:
```tsx
// After costPill useMemo, add:
const budgetInfo = useMemo(() => {
  const exceeded = budgetExceeded[task?.id ?? ""];
  if (!exceeded || !task?.usage) return null;
  const pct = Math.min((exceeded.spentUsd / exceeded.budgetUsd) * 100, 100);
  return { spentUsd: exceeded.spentUsd, budgetUsd: exceeded.budgetUsd, pct };
}, [task?.id, task?.usage, budgetExceeded]);

// JSX in details tab (after cost pill section):
{budgetInfo && (
  <div className="px-4 py-2">
    <div className="flex justify-between text-xs text-zinc-500 mb-1">
      <span>Budget</span>
      <span className={budgetInfo.pct >= 100 ? "text-red-500 font-medium" : ""}>
        ${budgetInfo.spentUsd.toFixed(4)} / ${budgetInfo.budgetUsd.toFixed(2)}
      </span>
    </div>
    <div className="h-1.5 w-full rounded-full bg-zinc-200">
      <div
        className={`h-1.5 rounded-full transition-all ${budgetInfo.pct >= 100 ? "bg-red-500" : budgetInfo.pct >= 90 ? "bg-amber-400" : "bg-blue-500"}`}
        style={{ width: `${budgetInfo.pct}%` }}
      />
    </div>
  </div>
)}
```
- **MIRROR**: Tailwind patterns from `costPill` display area; progress bar width from `gui/src/components/Modals/ProjectDetailDrawer.tsx:306-312`
- **IMPORTS**: `budgetExceeded` from `useBoardStore`
- **GOTCHA**: Only show bar when `budget_exceeded` event received — otherwise no budget concept shown (cleaner UX)
- **VALIDATE**: Trigger budget-exceeded event → bar appears red in drawer

### Task 14: ProjectDetailDrawer — budgetUsd input
- **ACTION**: Add `budgetUsd` to `DraftState`, `makeDraft`, `draftsEqual`, and add a `Field` in the settings tab
- **IMPLEMENT**:
```ts
// DraftState:
budgetUsd: string; // string for controlled input

// makeDraft:
budgetUsd: String(p.budgetUsd ?? ""),

// draftsEqual: compare budgetUsd strings

// On save, parse: budgetUsd: draft.budgetUsd ? parseFloat(draft.budgetUsd) : null

// JSX — after defaultBranch Field:
<Field label="Task budget (USD)">
  <input
    type="number"
    min="0"
    step="0.5"
    placeholder="2.00 (default)"
    value={draft.budgetUsd}
    onChange={(e) => setDraft((d) => d && { ...d, budgetUsd: e.target.value })}
    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
  />
</Field>
```
- **MIRROR**: `DRAFT_STATE_FIELD` pattern
- **IMPORTS**: none new
- **GOTCHA**: Input type="number" returns string — parse on save, not on change; blank = null = server default
- **VALIDATE**: Set budget in UI → PATCH updates project → budget enforced on next run

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `getTaskEffectiveBudget` — task has own budget | task.budgetUsd=1.0 | returns 1.0 | No |
| `getTaskEffectiveBudget` — inherit project | task.budgetUsd=null, project.budgetUsd=3.0 | returns 3.0 | No |
| `getTaskEffectiveBudget` — both null | both null | returns DEFAULT_TASK_BUDGET_USD (2.0) | No |
| Budget check fires | spentUsd >= budgetUsd | controller.abort() called | No |
| Budget check skips | effectiveBudget=null | no abort | Edge |
| Migration idempotent | run twice on same DB | no error | Edge |

### Edge Cases Checklist
- [ ] Budget = 0 (should abort immediately on first token)
- [ ] Budget = null project + null task → uses DEFAULT_TASK_BUDGET_USD
- [ ] Task deleted mid-run → `getTaskEffectiveBudget` returns null → no abort attempt
- [ ] `calculateCostUsd` returns 0 for unknown model → no false abort (0 < any budget)
- [ ] Concurrent WS frames — abort called twice → `controller.abort()` is idempotent

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: No lint errors

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: Both build clean

### Manual Validation
- [ ] Create project with `budgetUsd = 0.01`
- [ ] Start a task (drag to doing)
- [ ] Within seconds: task moves to error state with message containing "Budget exceeded"
- [ ] Task drawer shows red progress bar at 100%
- [ ] Toast appears: "Budget exceeded: $X.XXXX / $0.01"
- [ ] Partial work (any commits/files) preserved in working tree
- [ ] Set `budgetUsd = null` on project → task runs to completion without budget abort

---

## Acceptance Criteria
- [ ] All 14 tasks completed
- [ ] `npm run typecheck` + `pnpm typecheck` pass
- [ ] `pnpm lint` passes
- [ ] Both packages build clean
- [ ] Manual validation checklist passes
- [ ] `getTaskEffectiveBudget` tested with all three inheritance cases

## Completion Checklist
- [ ] Code follows `IDEMPOTENT_MIGRATION` pattern for DB changes
- [ ] `broadcastBudgetExceeded` mirrors `broadcastCiIterationStarted` style exactly
- [ ] `budget_exceeded` WsMessage added to BOTH `core/src/types/index.ts` AND `gui/src/types/index.ts`
- [ ] Budget check in BOTH `graphRunner.ts` AND `executor.ts`
- [ ] No hardcoded budget values — all use `DEFAULT_TASK_BUDGET_USD`
- [ ] Progress bar uses Tailwind classes consistent with existing UI
- [ ] No new npm/pnpm packages needed

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `calculateCostUsd` model mismatch (unknown model → 0 cost) | Low | Task never aborts | Fallback to `DEFAULT_MODEL` pricing if model not in table |
| Abort races with CI fix-loop — budget check fires mid-iteration | Medium | Abrupt state | Abort is idempotent; catch block already handles it cleanly |
| DB migration fails on existing prod DB | Low | Server crash on start | Idempotent pattern catches column-exists error |

## Notes
- "Pause" is not in current architecture — abort = SIGTERM to claude CLI child. User retries via existing retry flow. PRD says "pause-and-escalate" which maps to abort → error state → user-initiated retry.
- `task_node_runs.model` stores per-node model, but budget check uses task-level cumulative tokens with a single model fallback. Accurate enough for v1; Phase 7 hardening can do per-node-model cost attribution.
- `DEFAULT_TASK_BUDGET_USD = 2.0` chosen to match PRD "±5% of true API cost" validation goal — typical 2-node graph run costs ~$0.05–0.20 so $2 gives headroom for power users.
