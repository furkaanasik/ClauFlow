# Plan: Phase 7 — Hardening

## Summary
Production-quality hardening before broad announcement. Covers four concrete deliverables: pricing staleness warnings, abort-cascade unit tests, orphan-recovery tests, and a DB index for Insights perf. Docs for graph authoring, CI override, and budget config round out the phase.

## User Story
As a solo developer running ClauFlow unattended, I want the system to warn me when pricing data is stale, reliably recover interrupted tasks on restart, and load the Insights dashboard quickly, so I can trust the platform enough to leave jobs overnight.

## Problem → Solution
No staleness guard on hardcoded pricing table + no tests for abort cascade + no tests for orphan recovery + no projectId index slowing Insights queries → Add `isPricingStale()` + expose in API + show banner in GUI + add unit tests for abort/orphan + add DB index + write three doc files.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/orchestration-ci-observability.prd.md`
- **PRD Phase**: Phase 7 — Hardening
- **Estimated Files**: 15

---

## UX Design

### Before
```
┌────────────────────────────────────────┐
│ /insights                              │
│  ┌──────┐ ┌──────┐ ┌──────┐           │
│  │Tasks │ │Cost  │ │CI %  │           │
│  └──────┘ └──────┘ └──────┘           │
│  (no warning when pricing is old)     │
└────────────────────────────────────────┘
```

### After
```
┌────────────────────────────────────────┐
│ /insights                              │
│ ┌──────────────────────────────────┐   │
│ │ ⚠ Pricing table may be stale     │   │
│ │   (last updated 2026-05-04)       │   │
│ └──────────────────────────────────┘   │
│  ┌──────┐ ┌──────┐ ┌──────┐           │
│  │Tasks │ │Cost  │ │CI %  │           │
│  └──────┘ └──────┘ └──────┘           │
└────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `/insights` page | No pricing staleness signal | Warning banner when pricing >90 days old | Banner hidden when fresh |
| `GET /api/pricing` | `{ defaultModel, pricing }` | `{ defaultModel, pricing, updatedAt, stale }` | Backwards compatible — additive |
| `GET /api/insights` | `summary: { ... }` | `summary: { ..., pricingStale }` | Additive field |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/services/pricingService.ts` | all | Where `PRICING_UPDATED_AT` and `isPricingStale` go |
| P0 | `core/src/routes/pricing.ts` | all | Expose new fields |
| P0 | `core/src/routes/insights.ts` | 1-50 | Add `pricingStale` to summary |
| P0 | `core/src/services/taskService.ts` | 266-270 | Pattern for adding a DB index (idempotent `CREATE INDEX IF NOT EXISTS`) |
| P1 | `core/src/agents/graphRunner.ts` | 244-246 | Abort check at loop start — what the abort test exercises |
| P1 | `core/src/agents/graphRunner.test.ts` | all | Test structure to mirror for new abort tests |
| P1 | `core/src/services/taskService.ts` | 898-914 | `recoverOrphanedTasks` implementation |
| P1 | `core/src/services/taskService.nodeRuns.test.ts` | all | DB test pattern (real SQLite, beforeAll/afterAll cleanup) |
| P2 | `gui/src/lib/api.ts` | 88-93 | `InsightsData` interface to extend |
| P2 | `gui/src/lib/i18n/en.ts` | 351-377 | Insights i18n block |
| P2 | `gui/src/lib/i18n/types.ts` | all | Type for new key |
| P2 | `gui/src/app/insights/page.tsx` | 41-100 | Where banner goes |

## External Documentation
N/A — feature uses established internal patterns only.

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: core/src/services/pricingService.ts:12-50
export const PRICING_UPDATED_AT = "2026-05-04";   // ISO date constant
export function isPricingStale(now: Date = new Date()): boolean { ... }
export function getActivePricing(): ModelPricing[] { ... }
```

### DB_INDEX_PATTERN
```ts
// SOURCE: core/src/services/taskService.ts:266-269
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_node_runs_task_started
     ON task_node_runs(taskId, startedAt);`,
);
```

### ROUTE_PATTERN
```ts
// SOURCE: core/src/routes/pricing.ts:10-16
router.get("/", (_req: Request, res: Response) => {
  try {
    res.json({ defaultModel: DEFAULT_MODEL, pricing: getActivePricing() });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});
```

### TEST_STRUCTURE_UNIT
```ts
// SOURCE: core/src/services/pricingService.test.ts:1-8
import { describe, expect, it } from "vitest";
import { calculateCostUsd, DEFAULT_MODEL, ... } from "./pricingService.js";

describe("calculateCostUsd", () => {
  it("zero usage returns 0", () => {
    expect(...).toBe(0);
  });
});
```

### TEST_STRUCTURE_DB
```ts
// SOURCE: core/src/services/taskService.nodeRuns.test.ts:1-53
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, createTask, db, ... } from "./taskService.js";

const SUFFIX = `orphantest_${Date.now()}`;
let projectId = "";
let taskId = "";

beforeAll(async () => {
  const project = await createProject({ name: `..`, repoPath: `/tmp/${SUFFIX}`, ... });
  projectId = project.id;
  const task = await createTask({ projectId, title: "test", description: "" });
  taskId = task.id;
});

afterEach(() => {
  db.prepare(`DELETE FROM task_node_runs WHERE taskId = ?`).run(taskId);
});

afterAll(() => {
  if (taskId) db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  if (projectId) db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
});
```

### GRAPHRUNNER_ABORT_CHECK
```ts
// SOURCE: core/src/agents/graphRunner.ts:244-248
for (let i = startIdx; i < plan.order.length; i++) {
  const nodeId = plan.order[i]!;
  if (controller.signal.aborted) {
    throw new Error("aborted");         // <-- this fires before any I/O
  }
  // ... loadAgentDefinition, insertNodeRun, runClaude below
```

### I18N_PATTERN
```ts
// SOURCE: gui/src/lib/i18n/types.ts + en.ts + tr.ts
// Always touch ALL THREE files: types.ts (add key to interface), en.ts (English string), tr.ts (Turkish string)
insights: {
  pricingStaleBanner: string;
  pricingStaleUpdatedAt: string;  // e.g. "(last updated {date})"
};
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/services/pricingService.ts` | UPDATE | Add `PRICING_UPDATED_AT`, `isPricingStale()` |
| `core/src/routes/pricing.ts` | UPDATE | Expose `updatedAt` and `stale` in response |
| `core/src/routes/insights.ts` | UPDATE | Include `pricingStale` in summary object |
| `core/src/services/taskService.ts` | UPDATE | Add `idx_tasks_projectId` index (Insights perf) |
| `core/src/services/pricingService.test.ts` | UPDATE | Add `isPricingStale` unit tests |
| `core/src/services/taskService.orphan.test.ts` | CREATE | `recoverOrphanedTasks` DB integration test |
| `core/src/agents/graphRunner.test.ts` | UPDATE | Add abort-cascade unit tests |
| `gui/src/lib/api.ts` | UPDATE | Add `pricingStale?: boolean` to `InsightsData.summary` |
| `gui/src/lib/i18n/types.ts` | UPDATE | Add `pricingStaleBanner`, `pricingStaleUpdatedAt` keys |
| `gui/src/lib/i18n/en.ts` | UPDATE | English strings for staleness banner |
| `gui/src/lib/i18n/tr.ts` | UPDATE | Turkish strings for staleness banner |
| `gui/src/app/insights/page.tsx` | UPDATE | Render warning banner when `pricingStale` |
| `docs/graph-authoring.md` | CREATE | Graph authoring user guide |
| `docs/ci-config.md` | CREATE | CI node + override config guide |
| `docs/budget-config.md` | CREATE | Per-task and per-project budget guide |

## NOT Building
- Real-time pricing reconciliation against Anthropic billing API
- Load test harness (benchmark scripts) — PRD mentions this but no code target
- Abort cascade tests that shell out to the real `claude` CLI
- CiWatcher timer-based abort tests (require timer mocking; out of scope for Phase 7)
- Graph authoring UI changes (separate roadmap item: "Studio main node")

---

## Step-by-Step Tasks

### Task 1: Add pricing staleness to pricingService
- **ACTION**: Edit `core/src/services/pricingService.ts`
- **IMPLEMENT**:
  ```ts
  // After line 2 comment, add:
  export const PRICING_UPDATED_AT = "2026-05-04";  // ISO date; update when MODEL_PRICING changes
  
  export function isPricingStale(now: Date = new Date()): boolean {
    const updated = new Date(PRICING_UPDATED_AT);
    const diffMs = now.getTime() - updated.getTime();
    return diffMs > 90 * 24 * 60 * 60 * 1000;
  }
  ```
- **MIRROR**: `NAMING_CONVENTION` — constant SCREAMING_SNAKE, function camelCase
- **IMPORTS**: None (pure computation)
- **GOTCHA**: Do not change `PRICING_UPDATED_AT` to use `new Date()` at module load — it must be a static string so tests can control it.
- **VALIDATE**: `cd core && npm run typecheck` — zero errors

### Task 2: Expose staleness in pricing route
- **ACTION**: Edit `core/src/routes/pricing.ts`
- **IMPLEMENT**: Import `PRICING_UPDATED_AT`, `isPricingStale`; include in response:
  ```ts
  import { DEFAULT_MODEL, getActivePricing, PRICING_UPDATED_AT, isPricingStale } from "../services/pricingService.js";
  // ...
  res.json({
    defaultModel: DEFAULT_MODEL,
    pricing: getActivePricing(),
    updatedAt: PRICING_UPDATED_AT,
    stale: isPricingStale(),
  });
  ```
- **MIRROR**: `ROUTE_PATTERN`
- **GOTCHA**: Imports need `.js` extension (ESM TypeScript project)
- **VALIDATE**: `cd core && npm run typecheck`

### Task 3: Add `pricingStale` to insights route
- **ACTION**: Edit `core/src/routes/insights.ts`
- **IMPLEMENT**: Import `isPricingStale` and add field to summary:
  ```ts
  import { calculateCostUsd, DEFAULT_MODEL, isPricingStale } from "../services/pricingService.js";
  // ... inside the route handler, add to res.json:
  summary: {
    // ... existing fields ...
    pricingStale: isPricingStale(),
  },
  ```
- **MIRROR**: `ROUTE_PATTERN`
- **GOTCHA**: Add at the END of the `summary` object to minimize diff noise. Import `.js` extension.
- **VALIDATE**: `cd core && npm run typecheck`

### Task 4: Add DB index for Insights perf
- **ACTION**: Edit `core/src/services/taskService.ts` — add after line 269 (after existing `idx_node_runs_task_started`)
- **IMPLEMENT**:
  ```ts
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_projectId
       ON tasks(projectId);`,
  );
  ```
- **MIRROR**: `DB_INDEX_PATTERN` — same `db.exec` + `CREATE INDEX IF NOT EXISTS` pattern
- **GOTCHA**: This goes at module level (not inside a migration block) — same location as the existing node_runs index on line 266. No idempotency wrapper needed because `IF NOT EXISTS` handles it.
- **VALIDATE**: `cd core && npm run typecheck && npm test`

### Task 5: Add `isPricingStale` tests
- **ACTION**: Update `core/src/services/pricingService.test.ts` — add a new `describe` block at the end
- **IMPLEMENT**:
  ```ts
  import { ..., isPricingStale, PRICING_UPDATED_AT } from "./pricingService.js";

  describe("isPricingStale", () => {
    it("returns false on the day it was updated", () => {
      const updated = new Date(PRICING_UPDATED_AT);
      expect(isPricingStale(updated)).toBe(false);
    });

    it("returns false 89 days after update", () => {
      const d = new Date(PRICING_UPDATED_AT);
      d.setDate(d.getDate() + 89);
      expect(isPricingStale(d)).toBe(false);
    });

    it("returns true 91 days after update", () => {
      const d = new Date(PRICING_UPDATED_AT);
      d.setDate(d.getDate() + 91);
      expect(isPricingStale(d)).toBe(true);
    });

    it("uses current date when no arg passed (smoke test only)", () => {
      expect(typeof isPricingStale()).toBe("boolean");
    });
  });
  ```
- **MIRROR**: `TEST_STRUCTURE_UNIT`
- **GOTCHA**: Pass `now` explicitly in tests — never rely on `Date.now()` in tests because dates drift
- **VALIDATE**: `cd core && npm test` — all pass

### Task 6: Create orphan-recovery DB test
- **ACTION**: CREATE `core/src/services/taskService.orphan.test.ts`
- **IMPLEMENT**:
  ```ts
  import { afterAll, beforeAll, describe, expect, it } from "vitest";
  import {
    createProject,
    createTask,
    db,
    getTask,
    recoverOrphanedTasks,
    updateTask,
  } from "./taskService.js";

  const SUFFIX = `orphantest_${Date.now()}`;
  let projectId = "";
  let taskId = "";

  beforeAll(async () => {
    const project = await createProject({
      name: `Orphan Test ${SUFFIX}`,
      repoPath: `/tmp/${SUFFIX}`,
      defaultBranch: "main",
      slug: SUFFIX.toLowerCase().replace(/_/g, "-"),
    });
    projectId = project.id;
    const task = await createTask({
      projectId,
      title: "orphan recovery test",
      description: "",
    });
    taskId = task.id;
  });

  afterAll(() => {
    if (taskId) db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    if (projectId) db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  });

  describe("recoverOrphanedTasks", () => {
    it("rolls back a doing task to todo+error status", async () => {
      await updateTask(taskId, { status: "doing", agent: { status: "running" } });

      const before = await getTask(taskId);
      expect(before?.status).toBe("doing");

      const recovered = await recoverOrphanedTasks();
      expect(recovered).toBeGreaterThanOrEqual(1);

      const after = await getTask(taskId);
      expect(after?.status).toBe("todo");
      expect(after?.agent.status).toBe("error");
    });

    it("is idempotent — second call returns 0 when no doing tasks remain", async () => {
      const recovered = await recoverOrphanedTasks();
      expect(recovered).toBe(0);
    });
  });
  ```
- **MIRROR**: `TEST_STRUCTURE_DB`
- **IMPORTS**: `recoverOrphanedTasks` must be exported from `taskService.ts` — already is (line 898)
- **GOTCHA**: `updateTask` must accept `{ status: "doing", agent: { status: "running" } }` — check `updateTask` signature; if it doesn't accept partial agent, use direct DB stmt: `db.prepare("UPDATE tasks SET status='doing', agentStatus='running' WHERE id=?").run(taskId)`
- **VALIDATE**: `cd core && npm test` — all pass

### Task 7: Add abort-cascade tests to graphRunner.test.ts
- **ACTION**: Update `core/src/agents/graphRunner.test.ts` — add new `describe("runGraph abort cascade")` block
- **IMPLEMENT**:
  ```ts
  import { ..., runGraph } from "./graphRunner.js";

  describe("runGraph abort cascade", () => {
    const abortTask: Task = {
      id: "task_abort_test",
      projectId: "proj_abort",
      title: "abort test",
      description: "",
      analysis: "",
      status: "doing",
      priority: "medium",
      tags: [],
      branch: null, prUrl: null, prNumber: null, displayId: null,
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
      agent: {
        status: "running",
        currentStep: undefined,
        log: [],
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    };

    const abortProject: Project = {
      id: "proj_abort",
      name: "Abort Test",
      description: "",
      aiPrompt: "",
      repoPath: "/tmp/abort-test",
      defaultBranch: "main",
      remote: null,
      createdAt: "2026-05-04T00:00:00.000Z",
      planningStatus: "idle",
      slug: "abort-test",
      taskCounter: 0,
    };

    it("throws 'aborted' immediately when controller is pre-aborted", async () => {
      const graph: AgentGraph = {
        nodes: [node("a", "planner"), node("b", "coder")],
        edges: [edge("a", "b")],
      };
      const controller = new AbortController();
      controller.abort();

      await expect(
        runGraph(abortTask, abortProject, graph, controller, "main"),
      ).rejects.toThrow("aborted");
    });

    it("throws 'aborted' for a single-node graph when pre-aborted", async () => {
      const graph: AgentGraph = { nodes: [node("a", "planner")], edges: [] };
      const controller = new AbortController();
      controller.abort();

      await expect(
        runGraph(abortTask, abortProject, graph, controller, "main"),
      ).rejects.toThrow("aborted");
    });
  });
  ```
- **MIRROR**: `GRAPHRUNNER_ABORT_CHECK` — the abort check fires at `i=startIdx` before any filesystem/DB call
- **IMPORTS**: Import `runGraph` from `"./graphRunner.js"` — already imported in the test file header
- **GOTCHA**: `runGraph` checks abort BEFORE calling `loadAgentDefinition`, so no filesystem mock needed. The `RUNNING` map / DB is NOT touched because the abort short-circuits before `insertNodeRun`.
- **VALIDATE**: `cd core && npm test` — new tests pass

### Task 8: Update GUI InsightsData type
- **ACTION**: Edit `gui/src/lib/api.ts`
- **IMPLEMENT**: In `InsightsSummary` interface (around line 70), add optional field:
  ```ts
  pricingStale?: boolean;
  ```
- **MIRROR**: Existing optional fields pattern in the file
- **GOTCHA**: Use `?` (optional) so the field is backwards-compatible if core isn't yet deployed
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 9: Add i18n keys (all three files)
- **ACTION**: Touch `types.ts`, `en.ts`, `tr.ts`
- **IMPLEMENT in `types.ts`** (insights section):
  ```ts
  pricingStaleBanner: string;
  pricingStaleDate: string;
  ```
- **IMPLEMENT in `en.ts`** (insights section):
  ```ts
  pricingStaleBanner: "Pricing data may be out of date.",
  pricingStaleDate: "Last updated {date}",
  ```
- **IMPLEMENT in `tr.ts`** (insights section):
  ```ts
  pricingStaleBanner: "Fiyatlandırma verisi güncel olmayabilir.",
  pricingStaleDate: "Son güncelleme: {date}",
  ```
- **MIRROR**: `I18N_PATTERN` — add to ALL THREE files in the `insights` block
- **GOTCHA**: Missing key in any one file causes a TypeScript error because `Translations` is fully typed
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 10: Render staleness banner in Insights page
- **ACTION**: Edit `gui/src/app/insights/page.tsx`
- **IMPLEMENT**: After the `data` null check and before the stat cards, add:
  ```tsx
  {data.summary.pricingStale && (
    <div className="mb-4 flex items-center gap-2 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
      <span>⚠</span>
      <span>
        {t.insights.pricingStaleBanner}{" "}
        <span className="opacity-70">
          {t.insights.pricingStaleDate.replace("{date}", "2026-05-04")}
        </span>
      </span>
    </div>
  )}
  ```
- **MIRROR**: The existing `StatCard` component is in the same file; reuse the `border border-[var(--border)]` pattern for theming but use amber for warning
- **GOTCHA**: The date shown should come from the API (`data.summary.pricingStale` is a boolean; to show the actual date, either fetch `/api/pricing` or hardcode — for now hardcode as `PRICING_UPDATED_AT` is a well-known constant. Alternatively, if the API exposes `pricingUpdatedAt` in insights, use that.)
- **OPTION**: Simpler approach — just show the banner text without the date. Add `pricingUpdatedAt?: string` to `InsightsSummary` in `api.ts` and include it in the insights route response.
- **VALIDATE**: `cd gui && pnpm typecheck && pnpm lint`

### Task 11: Write graph authoring doc
- **ACTION**: CREATE `docs/graph-authoring.md`
- **IMPLEMENT**: Markdown guide covering:
  - What an agent graph is (nodes + edges in `.claude/agents/_graph.json`)
  - How to open Studio and drag nodes
  - Node types: `planner`, `coder`, `reviewer`, `tester`, `custom`
  - How a multi-node graph is executed (sequential, artifact passing)
  - How to create a new agent file (`.claude/agents/<slug>.md` frontmatter: `name`, `description`, `model`, `allowedTools`)
  - Legacy fallback: 0 or 1 nodes → single-claude path
  - Validation rules: exactly one entry, no cycles, no branching, no orphan nodes
- **GOTCHA**: No code changes — pure markdown
- **VALIDATE**: Visual review only

### Task 12: Write CI config doc
- **ACTION**: CREATE `docs/ci-config.md`
- **IMPLEMENT**: Markdown guide covering:
  - How the CI watcher works (polls `gh pr checks` after PR opens)
  - Fix loop: up to `CI_MAX_FIX_ITERATIONS` (default 3, env-configurable) iterations before escalating
  - `CI_POLL_INTERVAL_MS` env var (default 30s)
  - How to override the CI poll with environment variables
  - How task moves from `ci` column to `review` on pass or after max iterations
- **VALIDATE**: Visual review only

### Task 13: Write budget config doc
- **ACTION**: CREATE `docs/budget-config.md`
- **IMPLEMENT**: Markdown guide covering:
  - Default task budget: `DEFAULT_TASK_BUDGET_USD = 2.0` from `pricingService.ts`
  - Per-project override: `budgetUsd` column in `projects` table, editable via project settings
  - Per-task override: `budgetUsd` column in `tasks` table
  - What happens when budget exceeded: `broadcastBudgetExceeded` → `controller.abort()` → task goes to error
  - Pricing staleness warning: `PRICING_UPDATED_AT`, how to update it
- **VALIDATE**: Visual review only

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `isPricingStale` — same day | `now = new Date(PRICING_UPDATED_AT)` | `false` | No |
| `isPricingStale` — 89 days | `now = updated + 89d` | `false` | Boundary |
| `isPricingStale` — 91 days | `now = updated + 91d` | `true` | Boundary |
| `runGraph abort` — pre-aborted 2-node | `controller.aborted=true`, valid 2-node graph | throws `"aborted"` | No |
| `runGraph abort` — pre-aborted 1-node | `controller.aborted=true`, single node | throws `"aborted"` | No |
| `recoverOrphanedTasks` — does recover | Task in `doing` | `status=todo`, `agentStatus=error` | No |
| `recoverOrphanedTasks` — idempotent | No doing tasks | returns `0` | Yes |

### Edge Cases Checklist
- [x] `isPricingStale` uses explicit `now` param so tests don't depend on wall clock
- [x] Abort check fires before any filesystem I/O in `runGraph` — no mocks needed
- [x] `recoverOrphanedTasks` test cleans up after itself (afterAll) to not leave stale DB rows
- [x] `InsightsData.summary.pricingStale` is optional (`?`) — GUI handles `undefined` as non-stale

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

### Unit Tests
```bash
cd core && npm test
```
EXPECT: All tests pass, including new `isPricingStale`, `recoverOrphanedTasks`, and `runGraph abort` tests

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: No lint errors

### Manual Validation
- [ ] Start core (`cd core && npm run dev`) and gui (`cd gui && pnpm dev`)
- [ ] Open `/insights?projectId=<id>` — no banner when pricing is fresh (within 90 days)
- [ ] Temporarily set `PRICING_UPDATED_AT` to a date >90 days ago → banner appears
- [ ] `GET /api/pricing` returns `{ ..., updatedAt, stale }` fields
- [ ] `GET /api/insights?projectId=<id>` returns `summary.pricingStale: false/true`
- [ ] Restart core with a task in `doing` state (manually set via sqlite) → task moves to `todo+error`

---

## Acceptance Criteria
- [ ] `isPricingStale(date)` returns correct boolean for dates straddling the 90-day boundary
- [ ] `GET /api/pricing` includes `updatedAt` and `stale` fields
- [ ] `GET /api/insights` includes `summary.pricingStale`
- [ ] Insights GUI shows amber banner when `pricingStale: true`, hidden otherwise
- [ ] `recoverOrphanedTasks` test passes against real DB
- [ ] `runGraph` abort-cascade test passes (no mocks)
- [ ] `idx_tasks_projectId` index exists in DB after server start
- [ ] `docs/graph-authoring.md`, `docs/ci-config.md`, `docs/budget-config.md` created
- [ ] `cd core && npm test` — zero failures
- [ ] `cd core && npm run typecheck && cd gui && pnpm typecheck` — zero errors

## Completion Checklist
- [ ] All three i18n files updated together (types + en + tr)
- [ ] No hardcoded English strings in `.tsx` files
- [ ] `isPricingStale` uses explicit `now` param (testable)
- [ ] `PRICING_UPDATED_AT` updated to today's date (2026-05-04) in `pricingService.ts`
- [ ] DB index is idempotent (`IF NOT EXISTS`)
- [ ] No unnecessary scope additions (no extra UI polish, no new routes beyond what's listed)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `updateTask` signature doesn't accept `{ status, agent }` shorthand for DB test | Medium | Test won't compile | Use `db.prepare` directly to set `status='doing'` if API doesn't accept it |
| `pricingStale` optional field causes UI to always show banner (undefined vs false) | Low | Wrong banner state | Guard as `data.summary.pricingStale === true` not truthy check |
| `idx_tasks_projectId` conflicts with unnamed implicit index on FK | Low | DB startup error | `IF NOT EXISTS` handles this; SQLite only errors on duplicate named index |

## Notes
- Phase 6 (Fleet Dashboard) is `in-progress` — the `pricingStale` field in `/api/insights` should be coordinated with whoever finishes Phase 6 to avoid merge conflicts in `insights.ts`
- `PRICING_UPDATED_AT = "2026-05-04"` — the date this plan was written. Update this constant whenever `MODEL_PRICING` array changes.
- The `recoverOrphanedTasks` Turkish error message (`"Sunucu yeniden başlatıldı; task otomatik kurtarıldı"`) is intentionally left as-is; it only appears in internal logs.
- The docs in `docs/` are plain markdown — no special framework needed. They live at the repo root alongside `ROADMAP.md`.
