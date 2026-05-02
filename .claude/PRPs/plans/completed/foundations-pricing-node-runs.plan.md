# Plan: Phase 1 Foundations — Pricing Service, `task_node_runs` Table, Legacy Adapter

## Summary

De-risk the Orchestration / CI / Observability roadmap by landing the data + pricing infrastructure first: a new `task_node_runs` table that records every per-node execution row (with the existing single-claude executor writing one row per task as a "legacy graph" adapter), a model-aware pricing service that replaces the hardcoded Sonnet 4.5 constants in `gui/src/lib/cost.ts`, and three new node-tagged WebSocket events. No user-visible change yet — pure foundations so Phases 2–6 (graph runner, CI gate, dashboard) have a stable substrate.

## User Story

As a **ClauFlow maintainer preparing the multi-agent orchestration roadmap**, I want **per-node execution rows, server-canonical model-aware pricing, and node-tagged WS events landed first**, so that **subsequent phases can introduce the graph runner, CI gate, and `/insights` dashboard without retrofitting the data model or migrating existing rows.**

## Problem → Solution

**Current state**: token usage tracked only at task granularity (`tasks.inputTokens` etc.); cost computed in the GUI with hardcoded Sonnet 4.5 prices ([gui/src/lib/cost.ts:4](gui/src/lib/cost.ts#L4-L7)); no per-node row anywhere; WS events have no node concept.
**Desired state**: every executor run inserts a `task_node_runs` row keyed by `(taskId, nodeId)` capturing tokens + model + status, server returns canonical USD via `GET /api/pricing`, GUI `cost.ts` fetches the table once and caches, three new WS events (`node_started`, `node_finished`, `node_log`) exist but stay quiescent until Phase 2 starts emitting them.

## Metadata
- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/orchestration-ci-observability.prd.md](.claude/PRPs/prds/orchestration-ci-observability.prd.md)
- **PRD Phase**: Phase 1 — Foundations
- **Estimated Files**: ~10 (5 new, 5 edits)

---

## UX Design

Internal change — no user-facing UX transformation in this phase. Cost numbers in the existing task drawer stay identical (same math, just sourced from server); no new screens. The new WS events ship behind a `CLAUFLOW_NODE_EVENTS=1` env flag default-off, so frontend behavior is untouched.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Task cost display | GUI computes from hardcoded Sonnet 4.5 prices | GUI fetches `/api/pricing` once on mount, computes from server table | Numbers identical for Sonnet 4.5; correct for other models when used |
| WS events | 14 message types | 17 message types (3 new, default unused) | Gated by env flag; existing clients ignore unknown types defensively (already true via discriminated union) |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | [core/src/services/taskService.ts](core/src/services/taskService.ts) | 37–252 | Table CREATE + idempotent ALTER migration pattern to mirror exactly |
| P0 | [core/src/services/taskService.ts](core/src/services/taskService.ts) | 976–1110 | Tool-call CRUD pattern — `task_node_runs` follows the same shape |
| P0 | [core/src/services/taskService.ts](core/src/services/taskService.ts) | 1181–1218 | `updateTaskUsage` increment-on-existing-row idiom |
| P0 | [core/src/services/wsService.ts](core/src/services/wsService.ts) | 1–153 | Broadcast helper layout, including how new helpers are exported |
| P0 | [core/src/types/index.ts](core/src/types/index.ts) | 106–153 | `WsMessage` discriminated union — new variants must extend, not replace |
| P0 | [core/src/services/claudeService.ts](core/src/services/claudeService.ts) | 150–191 | `parseUsageFromResult` returns `ClaudeUsage`; reuse — do not duplicate |
| P0 | [core/src/agents/executor.ts](core/src/agents/executor.ts) | 1–55 | RUNNING map and slot lock — legacy adapter must not interfere |
| P0 | [core/src/agents/executor.ts](core/src/agents/executor.ts) | 280–340 | `onClaudeResult` is the integration point for legacy adapter cost rollup |
| P1 | [core/src/routes/tasks.ts](core/src/routes/tasks.ts) | 1–90 | Route shape: zod schemas, `errorMessage` import, response envelopes |
| P1 | [core/src/index.ts](core/src/index.ts) | 1–35 | Where to `app.use("/api/pricing", pricingRouter)` |
| P1 | [gui/src/lib/cost.ts](gui/src/lib/cost.ts) | 1–43 | Current pricing constants and exported function signatures to preserve |
| P1 | [gui/src/lib/api.ts](gui/src/lib/api.ts) | 1–40 | `api` object pattern for adding `getPricing()` |
| P1 | [gui/src/types/index.ts](gui/src/types/index.ts) | 158–197 | GUI-side `WsMessage` union — must mirror server additions |
| P2 | [core/src/services/claudeService.test.ts](core/src/services/claudeService.test.ts) | 1–164 | Vitest pattern for new pricing/node-run tests |

## External Documentation

No external research needed — feature uses established internal patterns (better-sqlite3 idempotent ALTER, Express+zod routes, existing WS broadcast layer).

---

## Patterns to Mirror

### IDEMPOTENT_TABLE_MIGRATION
```ts
// SOURCE: core/src/services/taskService.ts:109-147
{
  const toolCallTableExists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='task_tool_calls'`,
    )
    .get();
  if (toolCallTableExists) {
    const cols = db
      .prepare(`PRAGMA table_info(task_tool_calls)`)
      .all() as { name: string }[];
    const expected = ["id", "taskId", "toolName", /* ... */];
    for (const name of expected) {
      if (!cols.some((c) => c.name === name)) {
        const ddl: Record<string, string> = {
          args: `ALTER TABLE task_tool_calls ADD COLUMN args TEXT NOT NULL DEFAULT '{}'`,
          // ...
        };
        if (ddl[name]) db.exec(ddl[name]!);
      }
    }
  }
}
```
The new `task_node_runs` table follows this idiom exactly — `CREATE TABLE IF NOT EXISTS` in the main `db.exec()` block, plus an idempotent ALTER block underneath.

### REPO_CRUD_FUNCTIONS
```ts
// SOURCE: core/src/services/taskService.ts:1013-1075
const stmtInsertToolCall = db.prepare(
  `INSERT OR REPLACE INTO task_tool_calls (
    id, taskId, toolName, args, result, status,
    startedAt, finishedAt, durationMs, createdAt
  ) VALUES (
    @id, @taskId, @toolName, @args, @result, @status,
    @startedAt, @finishedAt, @durationMs, @createdAt
  )`,
);

export interface InsertToolCallInput { /* ... */ }

export function insertToolCall(input: InsertToolCallInput): ToolCall {
  const createdAt = new Date().toISOString();
  // ...
  stmtInsertToolCall.run({ /* ... */ });
  const row = stmtGetToolCall.get(input.id) as ToolCallRow | undefined;
  if (!row) throw new Error(`Tool call insert failed: ${input.id}`);
  return rowToToolCall(row);
}
```
`insertNodeRun` / `updateNodeRun` follow this exact shape: prepared statements at module top, `Insert*Input` interface, sync function returning the freshly-read row, throws on failure.

### WS_BROADCAST_HELPER
```ts
// SOURCE: core/src/services/wsService.ts:78-92
export function broadcastToolCall(toolCall: ToolCall): void {
  broadcast({
    type: "agent_tool_call",
    taskId: toolCall.taskId,
    payload: toolCall,
  });
}

export function broadcastAgentText(agentText: AgentText): void {
  broadcast({
    type: "agent_text",
    taskId: agentText.taskId,
    payload: agentText,
  });
}
```
Each WS event type gets a thin named helper. New `broadcastNodeStarted`, `broadcastNodeFinished`, `broadcastNodeLog` follow the same shape but check `process.env.CLAUFLOW_NODE_EVENTS === "1"` before broadcasting.

### EXPRESS_ROUTE
```ts
// SOURCE: core/src/routes/tasks.ts:73-81
router.get("/", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query as { projectId?: string };
    const tasks = await listTasks(projectId);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});
```
Pricing route mirrors this: `try/catch`, `errorMessage(err)` for 500s, response wrapped in a named field (`{ pricing }`).

### GUI_API_CLIENT
```ts
// SOURCE: gui/src/lib/api.ts:34-44
export const api = {
  getTasks: async (projectId?: string): Promise<Task[]> => {
    const url = projectId
      ? `${BASE}/tasks?projectId=${encodeURIComponent(projectId)}`
      : `${BASE}/tasks`;
    const data = await fetch(url, { cache: "no-store" }).then(
      (r) => handle<{ tasks: Task[] }>(r),
    );
    // ...
  },
  // ...
};
```
Add `getPricing` as a sibling method on the `api` object using the same `handle<T>` helper.

### USAGE_PARSE_REUSE
```ts
// SOURCE: core/src/services/claudeService.ts:166-191
export function parseUsageFromResult(raw: unknown): ClaudeUsage | null {
  // returns { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } | null
}
```
The legacy adapter calls this once per executor run (already does at [executor.ts:292](core/src/agents/executor.ts#L292)) and pipes the same `ClaudeUsage` into both `updateTaskUsage` (existing) and `updateNodeRun` (new) — no duplicate parsing.

### TEST_STRUCTURE
```ts
// SOURCE: core/src/services/claudeService.test.ts:1-44
import { describe, it, expect, vi } from "vitest";
import { createStreamJsonParser } from "./claudeService.js";

describe("createStreamJsonParser", () => {
  it("reassembles a single event split across multiple feed chunks", () => {
    // arrange / act / assert
  });
});
```
New tests live in `pricingService.test.ts` and `taskService.nodeRuns.test.ts` using vitest, same import style (`*.js` suffix because of NodeNext module resolution).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/types/index.ts` | UPDATE | Add `NodeRun`, `NodeRunStatus`, `NodeType`; extend `WsMessage` union with 3 variants |
| `core/src/services/taskService.ts` | UPDATE | Add `task_node_runs` CREATE + idempotent ALTER block + `insertNodeRun` / `updateNodeRun` / `listNodeRunsByTask` / `getNodeRun` |
| `core/src/services/pricingService.ts` | CREATE | New module: `MODEL_PRICING` table + `calculateCostUsd(usage, model)` + `getActivePricing()` |
| `core/src/services/pricingService.test.ts` | CREATE | Unit tests for pricing math + missing-model fallback |
| `core/src/services/wsService.ts` | UPDATE | Add `broadcastNodeStarted` / `broadcastNodeFinished` / `broadcastNodeLog` helpers, env-flag-gated |
| `core/src/routes/pricing.ts` | CREATE | New router: `GET /api/pricing` returning the table |
| `core/src/index.ts` | UPDATE | Mount `app.use("/api/pricing", pricingRouter)` |
| `core/src/agents/executor.ts` | UPDATE | Insert `task_node_runs` row at executor start (`legacy:coder` node), update on completion/error with usage + model |
| `core/src/services/taskService.nodeRuns.test.ts` | CREATE | Round-trip tests: insert → update → list → get |
| `gui/src/lib/cost.ts` | UPDATE | Replace hardcoded constants with cached fetch-from-server; preserve `calculateCost / formatTokens / totalTokens` exported names |
| `gui/src/lib/api.ts` | UPDATE | Add `api.getPricing()` |
| `gui/src/types/index.ts` | UPDATE | Mirror server `NodeRun` type + 3 new `WsMessage` variants |

## NOT Building

- The graph runner itself — Phase 2.
- Any `/insights` dashboard page or aggregation queries — Phase 6.
- Any new node types beyond the legacy adapter row (`coder`) — Phase 2 introduces `planner`/`reviewer`, Phase 4 introduces `ci`/`fix`.
- Per-task USD budget / cost guard — Phase 5.
- Modifications to `commentRunner.ts` — comment runs stay outside `task_node_runs` for v1; revisit when Phase 2 lands.
- Removing the GUI-side `cost.ts` math — server is canonical for new code, but GUI math stays as a fallback when `/api/pricing` is unreachable (offline-friendly).
- A `migrations/` folder or migration framework — current inline ALTER pattern is intentionally preserved.

---

## Step-by-Step Tasks

### Task 1: Extend types — add NodeRun, NodeRunStatus, NodeType, WsMessage variants
- **ACTION**: Edit `core/src/types/index.ts`.
- **IMPLEMENT**:
  ```ts
  export type NodeRunStatus = "running" | "done" | "error" | "aborted";
  export type NodeType = "planner" | "coder" | "reviewer" | "tester" | "ci" | "fix" | "custom";

  export interface NodeRun {
    id: string;             // `noderun_<uuid8>`
    taskId: string;
    nodeId: string;         // graph node id; "legacy:coder" for adapter rows
    nodeType: NodeType;
    status: NodeRunStatus;
    startedAt: string;
    finishedAt: string | null;
    inputArtifact: Record<string, unknown> | null;
    outputArtifact: Record<string, unknown> | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    model: string | null;   // e.g. "claude-sonnet-4-5"; null when unknown
    ciIteration: number | null;
    errorMessage: string | null;
  }
  ```
  Extend `WsMessage` union with:
  ```ts
  | { type: "node_started"; taskId: string; payload: NodeRun }
  | { type: "node_finished"; taskId: string; payload: NodeRun }
  | { type: "node_log"; taskId: string; payload: { nodeId: string; line: string } }
  ```
- **MIRROR**: Existing `ToolCall` interface in same file.
- **IMPORTS**: none new.
- **GOTCHA**: Discriminated union — keep `type` literal first; both server and GUI unions diverge; mirror in `gui/src/types/index.ts` later (Task 11).
- **VALIDATE**: `cd core && npm run typecheck` exits 0.

### Task 2: Add `task_node_runs` table + CRUD to taskService
- **ACTION**: Edit `core/src/services/taskService.ts`.
- **IMPLEMENT**:
  1. In the main `db.exec(\`...\`)` block at line 37, append:
     ```sql
     CREATE TABLE IF NOT EXISTS task_node_runs (
       id TEXT PRIMARY KEY,
       taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
       nodeId TEXT NOT NULL,
       nodeType TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'running',
       startedAt TEXT NOT NULL,
       finishedAt TEXT,
       inputArtifact TEXT,
       outputArtifact TEXT,
       inputTokens INTEGER NOT NULL DEFAULT 0,
       outputTokens INTEGER NOT NULL DEFAULT 0,
       cacheReadTokens INTEGER NOT NULL DEFAULT 0,
       cacheWriteTokens INTEGER NOT NULL DEFAULT 0,
       model TEXT,
       ciIteration INTEGER,
       errorMessage TEXT,
       createdAt TEXT NOT NULL
     );
     ```
  2. Add idempotent ALTER block right after, mirroring lines 109–147.
  3. Add index: `CREATE INDEX IF NOT EXISTS idx_node_runs_task_started ON task_node_runs(taskId, startedAt);`.
  4. Add row interface, `rowToNodeRun`, prepared statements, and exports `insertNodeRun(input)`, `updateNodeRun(id, patch)`, `listNodeRunsByTask(taskId)`, `getNodeRun(id)`.
- **MIRROR**: Tool-call section at lines 976–1110 (interfaces, prepared statements, helpers).
- **IMPORTS**: `import { randomUUID } from "node:crypto"` (already imported at line 3).
- **GOTCHA**: `inputArtifact` and `outputArtifact` are stored as JSON strings in SQLite; parse on read with try/catch and fall back to `null`. `nodeType` and `status` are stored as plain strings — cast on read. Use `INSERT OR REPLACE` like `stmtInsertToolCall` so re-runs of the same `id` are safe.
- **VALIDATE**: `cd core && npm run typecheck` clean; manual: delete `core/data/tasks.db`, restart `npm run dev`, confirm `task_node_runs` table exists via `sqlite3 core/data/tasks.db ".schema task_node_runs"`.

### Task 3: Round-trip test for node-runs CRUD
- **ACTION**: Create `core/src/services/taskService.nodeRuns.test.ts`.
- **IMPLEMENT**: vitest spec that creates a project + task in a temp DB (use the existing `db` export — tests already share the dev DB), inserts a node run, updates it with token usage, lists by task id, asserts shape. One test for `INSERT OR REPLACE` idempotency.
- **MIRROR**: `core/src/services/claudeService.test.ts` style (single-file describe blocks, vi mocks where needed).
- **IMPORTS**: `import { describe, it, expect } from "vitest";`
- **GOTCHA**: Vitest uses NodeNext resolution — relative imports must end in `.js`. Tests run against the live `data/tasks.db`; if running CI, prefer creating throwaway IDs (`task_test_${Date.now()}`) and cleaning up in `afterEach`.
- **VALIDATE**: `cd core && npm test -- nodeRuns` passes.

### Task 4: Pricing service module
- **ACTION**: Create `core/src/services/pricingService.ts`.
- **IMPLEMENT**:
  ```ts
  export interface ModelPricing {
    model: string;
    inputPerM: number;
    outputPerM: number;
    cacheCreationPerM: number;
    cacheReadPerM: number;
  }

  // Source: https://docs.anthropic.com/en/docs/about-claude/models  (per 1M tokens, USD)
  export const MODEL_PRICING: ModelPricing[] = [
    { model: "claude-sonnet-4-5", inputPerM: 3.0, outputPerM: 15.0, cacheCreationPerM: 3.75, cacheReadPerM: 0.3 },
    { model: "claude-sonnet-4-6", inputPerM: 3.0, outputPerM: 15.0, cacheCreationPerM: 3.75, cacheReadPerM: 0.3 },
    { model: "claude-opus-4-5", inputPerM: 15.0, outputPerM: 75.0, cacheCreationPerM: 18.75, cacheReadPerM: 1.5 },
    { model: "claude-opus-4-7", inputPerM: 15.0, outputPerM: 75.0, cacheCreationPerM: 18.75, cacheReadPerM: 1.5 },
    { model: "claude-haiku-4-5", inputPerM: 1.0, outputPerM: 5.0, cacheCreationPerM: 1.25, cacheReadPerM: 0.1 },
  ];

  export const DEFAULT_MODEL = "claude-sonnet-4-5";

  export interface UsageInput {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }

  export function calculateCostUsd(usage: UsageInput, model?: string | null): number {
    const p =
      MODEL_PRICING.find((m) => m.model === (model ?? DEFAULT_MODEL)) ??
      MODEL_PRICING.find((m) => m.model === DEFAULT_MODEL)!;
    return (
      (usage.inputTokens * p.inputPerM +
        usage.outputTokens * p.outputPerM +
        usage.cacheWriteTokens * p.cacheCreationPerM +
        usage.cacheReadTokens * p.cacheReadPerM) /
      1_000_000
    );
  }

  export function getActivePricing(): ModelPricing[] {
    return MODEL_PRICING.slice();
  }
  ```
- **MIRROR**: simple stateless services like `core/src/utils/error.ts` — pure functions, named exports, no DB.
- **IMPORTS**: none.
- **GOTCHA**: Hardcode the table for v1 — Phase 7 adds a "stale pricing >90d" warning. Unknown model falls back to default silently; do not throw (would cascade into executor failures). Numbers match the current GUI hardcode for Sonnet 4.5 to keep displayed cost identical.
- **VALIDATE**: pricing test (next task).

### Task 5: Pricing service unit tests
- **ACTION**: Create `core/src/services/pricingService.test.ts`.
- **IMPLEMENT**: Three tests — known model returns expected cost (use 1M of each token type → matches `inputPerM + outputPerM + cacheCreationPerM + cacheReadPerM`); unknown model falls back to default; null model uses default.
- **MIRROR**: `claudeService.test.ts`.
- **IMPORTS**: `import { calculateCostUsd, MODEL_PRICING } from "./pricingService.js";`
- **VALIDATE**: `cd core && npm test -- pricingService` passes.

### Task 6: Pricing route
- **ACTION**: Create `core/src/routes/pricing.ts`.
- **IMPLEMENT**:
  ```ts
  import { Router, type Request, type Response } from "express";
  import { errorMessage } from "../utils/error.js";
  import { getActivePricing, DEFAULT_MODEL } from "../services/pricingService.js";

  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    try {
      res.json({ defaultModel: DEFAULT_MODEL, pricing: getActivePricing() });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  export default router;
  ```
- **MIRROR**: `core/src/routes/tasks.ts:73-81`.
- **IMPORTS**: as shown.
- **GOTCHA**: keep payload shape as `{ defaultModel, pricing: ModelPricing[] }` — the GUI assumes an envelope and the existing `handle<T>` parses `r.json()` directly.
- **VALIDATE**: start server, `curl http://localhost:3001/api/pricing` returns the table.

### Task 7: Mount pricing route
- **ACTION**: Edit `core/src/index.ts`.
- **IMPLEMENT**: Add `import pricingRouter from "./routes/pricing.js";` and `app.use("/api/pricing", pricingRouter);` near the other `app.use("/api/...")` calls.
- **MIRROR**: existing `app.use` lines 25–32.
- **IMPORTS**: as above.
- **GOTCHA**: Order doesn't matter for these prefixes; place alphabetically near `tasks` for readability.
- **VALIDATE**: `cd core && npm run typecheck` clean; restart dev server; `curl /api/pricing` works.

### Task 8: WS broadcast helpers (env-gated)
- **ACTION**: Edit `core/src/services/wsService.ts`.
- **IMPLEMENT**:
  ```ts
  function nodeEventsEnabled(): boolean {
    return process.env.CLAUFLOW_NODE_EVENTS === "1";
  }

  export function broadcastNodeStarted(nodeRun: NodeRun): void {
    if (!nodeEventsEnabled()) return;
    broadcast({ type: "node_started", taskId: nodeRun.taskId, payload: nodeRun });
  }

  export function broadcastNodeFinished(nodeRun: NodeRun): void {
    if (!nodeEventsEnabled()) return;
    broadcast({ type: "node_finished", taskId: nodeRun.taskId, payload: nodeRun });
  }

  export function broadcastNodeLog(taskId: string, nodeId: string, line: string): void {
    if (!nodeEventsEnabled()) return;
    broadcast({ type: "node_log", taskId, payload: { nodeId, line } });
  }
  ```
  Add `NodeRun` to the type imports at line 3.
- **MIRROR**: `broadcastToolCall` / `broadcastAgentText` at lines 78–92.
- **IMPORTS**: `NodeRun` from `../types/index.js`.
- **GOTCHA**: Env flag default-off keeps Phase 1 dark-launch — Phase 2 flips the flag in dev once the graph runner emits these. No call sites in Phase 1 outside the legacy adapter (Task 9), and the adapter calls them so the gate works there too.
- **VALIDATE**: `cd core && npm run typecheck` clean.

### Task 9: Legacy adapter — write `task_node_runs` row from executor
- **ACTION**: Edit `core/src/agents/executor.ts`.
- **IMPLEMENT**:
  1. Near the top of `run()` (after `acquireSlot` returns and before the first `runClaude` call ~ line 304), insert a `task_node_runs` row:
     ```ts
     const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;
     const nodeRun = insertNodeRun({
       id: nodeRunId,
       taskId: task.id,
       nodeId: "legacy:coder",
       nodeType: "coder",
       status: "running",
       startedAt: new Date().toISOString(),
       inputArtifact: null,
       model: process.env.CLAUFLOW_DEFAULT_MODEL ?? null,
     });
     broadcastNodeStarted(nodeRun);
     ```
  2. In `onClaudeResult` (line 291–302), after `updateTaskUsage`, also `updateNodeRun(nodeRunId, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })`. The node-run accumulates the same per-run usage delta.
  3. On successful PR open / no-op done path: `updateNodeRun(nodeRunId, { status: "done", finishedAt: new Date().toISOString() })` and `broadcastNodeFinished(refreshedNodeRun)`.
  4. On error path (existing `catch` at line 466): `updateNodeRun(nodeRunId, { status: "error", finishedAt: new Date().toISOString(), errorMessage: err.message })` and broadcast finished.
  5. On abort: `status: "aborted"`.
- **MIRROR**: tool-call insert/update around `onToolCallStart`/`onToolCallEnd` already in this file.
- **IMPORTS**: add `insertNodeRun`, `updateNodeRun`, `getNodeRun` to the existing taskService import block at lines 10–20; add `randomUUID` from `node:crypto`; add `broadcastNodeStarted`, `broadcastNodeFinished` to the wsService import block at lines 22–28.
- **GOTCHA**: This row is the *legacy adapter* — Phase 2 stops creating it once the real graph runner takes over. Do **not** alter the existing `updateTaskUsage` call; the new `updateNodeRun` is additive. If the executor falls back to text mode (line 319), still update the row with whatever usage was captured (probably zeros). Wrap `insertNodeRun` in a try/catch — failure to write the row must NOT fail the executor; log via `console.error` and continue. The row gets `nodeType: "coder"` so Phase 6 aggregation can group all legacy rows into one bucket.
- **VALIDATE**: Run an existing task end-to-end; query `sqlite3 core/data/tasks.db "SELECT id, taskId, nodeType, status, inputTokens, outputTokens FROM task_node_runs ORDER BY startedAt DESC LIMIT 5;"` shows the new row with non-zero token counts after completion.

### Task 10: GUI — fetch pricing once, expose via cost.ts
- **ACTION**: Edit `gui/src/lib/cost.ts` and `gui/src/lib/api.ts`.
- **IMPLEMENT**:
  1. In `api.ts`, add to the `api` object:
     ```ts
     getPricing: async (): Promise<{ defaultModel: string; pricing: ModelPricing[] }> => {
       return fetch(`${BASE}/pricing`, { cache: "no-store" }).then(
         (r) => handle<{ defaultModel: string; pricing: ModelPricing[] }>(r),
       );
     },
     ```
     Add `interface ModelPricing` mirroring the server type (or import from `@/types` once added in Task 11).
  2. In `cost.ts`, replace hardcoded constants with a module-scoped cache + lazy fetcher:
     ```ts
     import { api } from "./api";

     // Sonnet 4.5 fallback prices — used until the server pricing table loads.
     const FALLBACK: Record<string, { input: number; output: number; cw: number; cr: number }> = {
       default: { input: 3.0, output: 15.0, cw: 3.75, cr: 0.3 },
     };

     let cache: { defaultModel: string; table: Map<string, { input: number; output: number; cw: number; cr: number }> } | null = null;
     let inflight: Promise<void> | null = null;

     async function ensureLoaded(): Promise<void> {
       if (cache) return;
       if (!inflight) {
         inflight = api.getPricing().then((res) => {
           const t = new Map<string, { input: number; output: number; cw: number; cr: number }>();
           for (const p of res.pricing) {
             t.set(p.model, { input: p.inputPerM, output: p.outputPerM, cw: p.cacheCreationPerM, cr: p.cacheReadPerM });
           }
           cache = { defaultModel: res.defaultModel, table: t };
         }).catch(() => { /* keep fallback */ });
       }
       await inflight;
     }

     export function calculateCost(usage: TaskUsage, model?: string | null): number {
       const key = model ?? cache?.defaultModel ?? "default";
       const p = cache?.table.get(key) ?? FALLBACK.default;
       return (
         (usage.inputTokens * p.input +
           usage.outputTokens * p.output +
           usage.cacheWriteTokens * p.cw +
           usage.cacheReadTokens * p.cr) /
         1_000_000
       );
     }

     // Trigger fetch on module load — no top-level await needed.
     void ensureLoaded();
     ```
     Keep `formatTokens` and `totalTokens` exports unchanged.
- **MIRROR**: existing `api` object pattern at `gui/src/lib/api.ts:34-44`.
- **IMPORTS**: `import { api } from "./api";`.
- **GOTCHA**: `calculateCost` stays sync — current callers don't await it. The fallback prices match the previous hardcoded values, so during the brief window before pricing loads (or if the request fails), numbers are identical to today. Adding a `model` parameter is **non-breaking** because it's optional. Phase 2+ will start passing `model` from per-node-run data.
- **VALIDATE**: `cd gui && pnpm typecheck` clean; `cd gui && pnpm lint` clean; manual: open the board, confirm task drawer cost numbers identical to before, network tab shows one `/api/pricing` request.

### Task 11: GUI types parity
- **ACTION**: Edit `gui/src/types/index.ts`.
- **IMPLEMENT**: Mirror server-side additions:
  ```ts
  export type NodeRunStatus = "running" | "done" | "error" | "aborted";
  export type NodeType = "planner" | "coder" | "reviewer" | "tester" | "ci" | "fix" | "custom";

  export interface NodeRun {
    id: string;
    taskId: string;
    nodeId: string;
    nodeType: NodeType;
    status: NodeRunStatus;
    startedAt: string;
    finishedAt: string | null;
    inputArtifact: Record<string, unknown> | null;
    outputArtifact: Record<string, unknown> | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    model: string | null;
    ciIteration: number | null;
    errorMessage: string | null;
  }

  export interface ModelPricing {
    model: string;
    inputPerM: number;
    outputPerM: number;
    cacheCreationPerM: number;
    cacheReadPerM: number;
  }
  ```
  Extend the `WsMessage` union with the same three variants (`node_started`, `node_finished`, `node_log`).
- **MIRROR**: existing `ToolCall` and `WsMessage` in this file.
- **IMPORTS**: none.
- **GOTCHA**: GUI union and server union diverge by design (GUI may add purely client-side variants later); just mirror the additions, do not deduplicate. No consumer of `NodeRun` exists in Phase 1 — it's just the contract for Phase 2.
- **VALIDATE**: `cd gui && pnpm typecheck` clean.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `calculateCostUsd` known Sonnet 4.5 model | `{ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }` + `"claude-sonnet-4-5"` | `3.0` | No |
| `calculateCostUsd` unknown model | usage + `"claude-fake"` | falls back to Sonnet 4.5 cost (no throw) | Yes |
| `calculateCostUsd` null model | usage + `null` | uses `DEFAULT_MODEL` | Yes |
| `calculateCostUsd` zero usage | all zeros | `0` | Yes |
| `insertNodeRun` + `getNodeRun` round-trip | minimal valid input | row equals input + defaults | No |
| `updateNodeRun` partial patch | `{ status: "done", outputTokens: 1234 }` | only those fields change | No |
| `insertNodeRun` with same id twice | two inserts with same `id` | second one overwrites (INSERT OR REPLACE semantics) | Yes |
| `listNodeRunsByTask` ordering | three rows with staggered `startedAt` | returned in ascending `startedAt` order | No |

### Edge Cases Checklist
- [x] Empty input — covered by zero-usage test
- [x] Maximum size input — N/A (numeric, no buffer)
- [x] Invalid types — `inputArtifact` malformed JSON falls back to `null` on read
- [x] Concurrent access — SQLite WAL handles concurrent reads; one writer at a time is fine
- [ ] Network failure — pricing fetch failure path tested manually (offline browser tab still shows fallback prices)
- [x] Permission denied — N/A

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
cd gui && pnpm typecheck
```
EXPECT: Zero type errors in both.

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: No new errors. (No lint config in `core/`.)

### Unit Tests
```bash
cd core && npm test -- pricingService nodeRuns
```
EXPECT: All new tests pass; existing `claudeService.test.ts` and `slug.test.ts` still pass.

### Full Test Suite
```bash
cd core && npm test
```
EXPECT: No regressions.

### Database Validation
```bash
# After restarting dev server with a fresh DB:
sqlite3 core/data/tasks.db ".schema task_node_runs"
sqlite3 core/data/tasks.db ".indexes task_node_runs"
```
EXPECT: Schema matches Task 2 DDL; index `idx_node_runs_task_started` present.

```bash
# After restarting against an existing pre-Phase-1 DB (idempotent migration):
cp core/data/tasks.db.migrated.bak core/data/tasks.db   # if you have a backup
cd core && npm run dev   # boot
sqlite3 core/data/tasks.db ".schema task_node_runs"
```
EXPECT: Table created additively; existing `tasks` / `comments` / `task_tool_calls` rows untouched.

### Browser Validation
```bash
# Two terminals
cd core && npm run dev
cd gui && pnpm dev
```
EXPECT:
- Network tab shows one `GET http://localhost:3001/api/pricing` on initial load.
- Existing task drawer cost numbers identical to pre-change.
- Drag a task to `doing`; after completion, `sqlite3 core/data/tasks.db "SELECT * FROM task_node_runs ORDER BY startedAt DESC LIMIT 1;"` shows a `legacy:coder` row with `status='done'` and non-zero tokens.

### Manual Validation
- [ ] `npm run dev` (core) starts without migration errors
- [ ] `pnpm dev` (gui) starts; landing + board render
- [ ] Existing task with prior `inputTokens` displays same USD as before
- [ ] New task run produces a `task_node_runs` row
- [ ] `CLAUFLOW_NODE_EVENTS=1 npm run dev` does NOT change observable behavior in this phase (no consumers yet)
- [ ] `curl http://localhost:3001/api/pricing` returns expected envelope
- [ ] Aborting a `doing` task transitions the node-run row to `status='aborted'`

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (`pricingService.test.ts`, `taskService.nodeRuns.test.ts`)
- [ ] No type errors
- [ ] No lint errors
- [ ] Existing task UX unchanged
- [ ] One `task_node_runs` row written per executor run
- [ ] `/api/pricing` endpoint reachable and shaped as documented

## Completion Checklist
- [ ] Code follows discovered patterns (idempotent ALTER, prepared statements, broadcast helpers, route shape)
- [ ] Error handling matches codebase style (`errorMessage(err)`, console.error for non-fatal logs)
- [ ] Logging follows codebase conventions (`console.log("[component] message")`)
- [ ] Tests follow vitest pattern from `claudeService.test.ts`
- [ ] No hardcoded values that should be config (model id list lives in `pricingService.ts`, env flag for WS gate)
- [ ] Documentation updated — N/A (no public docs surface for this phase)
- [ ] No unnecessary scope additions
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `insertNodeRun` failure cascades into executor failure | M | H — would block all task runs | Wrap in try/catch in executor; log and continue |
| Idempotent ALTER misses a column on a particularly old DB | L | M — schema drift | New table is `CREATE TABLE IF NOT EXISTS`, no ALTER needed for fresh column adds; only future column adds need ALTER |
| GUI cost display flickers while pricing fetch in flight | L | L | Fallback prices are identical to current hardcoded values, so first paint is correct |
| WS env flag accidentally enabled in prod before Phase 2 | L | L | No consumer in this phase; broadcasting unused events to existing clients is a no-op (discriminated union ignores unknown variants) |
| Pricing table drifts from Anthropic actual prices | L | M — wrong cost shown | Phase 7 adds staleness warning; for now, comment in `pricingService.ts` references the source URL |
| `task_node_runs` rows orphaned if task deleted before executor finishes | L | L | `ON DELETE CASCADE` on the FK handles this |

## Notes

- The legacy adapter row uses `nodeId: "legacy:coder"` so Phase 6 aggregation can `WHERE nodeId NOT LIKE 'legacy:%'` to exclude pre-graph data, or include it grouped under `nodeType: 'coder'` — both queries are clean.
- `model: process.env.CLAUFLOW_DEFAULT_MODEL ?? null` is intentionally lax — Phase 1 doesn't probe `claude --version` or detect actual model. Phase 5 (cost guardrails) tightens this. Pricing fallback ensures cost is still reasonable when `null`.
- `commentRunner.ts` does NOT get a node-run row in this phase — comment runs already increment `tasks.usage` via the same path; bringing them into the node-run model is Phase 2 territory because comments will eventually map to a specific node in the graph.
- Tests share the live `data/tasks.db`. If flakiness emerges, switch to a per-suite in-memory DB (`new Database(":memory:")`) by extracting the DB constructor — out of scope here.
- The `bypassPermissions` security smell flagged in the PRD is **not** addressed in this phase; per-node tool whitelists arrive in Phase 2.
