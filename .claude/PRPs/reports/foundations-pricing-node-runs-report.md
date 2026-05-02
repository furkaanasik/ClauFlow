# Implementation Report: Phase 1 Foundations — Pricing Service, `task_node_runs` Table, Legacy Adapter

## Summary

Landed the data + pricing infrastructure for the Orchestration / CI / Observability roadmap. Added a new `task_node_runs` SQLite table (with idempotent ALTER migration mirroring `task_tool_calls`), a server-canonical `pricingService` keyed by model id, a `GET /api/pricing` route, three env-gated WebSocket events (`node_started`/`node_finished`/`node_log`), and a "legacy adapter" in `executor.ts` that writes one `coder` node-run per task. GUI `cost.ts` now fetches pricing from the server with a Sonnet 4.5 fallback for first-paint correctness; the task drawer's existing math is preserved. No user-visible UX change; all changes are additive.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium (matched) |
| Confidence | 8/10 | Single-pass — no rework needed |
| Files Changed | ~10 (5 new, 5 edits) | 12 (5 new, 7 edits) |
| Tests Added | 8 | 15 (6 nodeRuns + 9 pricingService) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Extend core types (`NodeRun`, `NodeRunStatus`, `NodeType`, 3 WS variants) | Complete | |
| 2 | `task_node_runs` table + CRUD in `taskService.ts` | Complete | Added `createdAt` field to `NodeRun` (not in original plan but matches `ToolCall` shape) |
| 3 | Round-trip test for node-runs CRUD | Complete | 6 tests, all green |
| 4 | `pricingService.ts` module with 5 model entries | Complete | |
| 5 | `pricingService.test.ts` unit tests | Complete | 9 tests, all green |
| 6 | `core/src/routes/pricing.ts` (`GET /api/pricing`) | Complete | |
| 7 | Mount pricing router in `core/src/index.ts` | Complete | |
| 8 | WS broadcast helpers (`broadcastNodeStarted/Finished/Log`), env-gated | Complete | Default-off via `CLAUFLOW_NODE_EVENTS=1` |
| 9 | Executor legacy adapter (1 row/task, `nodeId="legacy:coder"`) | Complete | Added `finalizeNodeRun()` private helper; wraps insert in try/catch so telemetry never breaks executor |
| 10 | GUI `cost.ts` async pricing fetch + `api.getPricing()` | Complete | Module-load triggered fetch, sync `calculateCost` preserved with optional `model?` arg |
| 11 | GUI types parity (`NodeRun` + 3 WS variants) | Complete | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (core typecheck) | Pass | Zero errors |
| Static Analysis (gui typecheck) | Pass | Zero errors |
| Lint (gui) | Pass | No ESLint warnings or errors |
| Unit Tests (core) | Pass | 4 files, **36/36** tests green (includes pre-existing `slug.test.ts` and `claudeService.test.ts`) |
| Build (core) | Pass | `tsc -p tsconfig.json` clean |
| Integration | N/A | Plan didn't mandate live server start; API shape covered by typecheck and unit tests |
| Edge Cases | Pass | Tested: zero usage, unknown model, null model, undefined model, INSERT OR REPLACE idempotency, malformed JSON artifact fallback, ordering by startedAt |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `core/src/types/index.ts` | UPDATED | +38 |
| `core/src/services/taskService.ts` | UPDATED | +287 |
| `core/src/services/pricingService.ts` | CREATED | new file |
| `core/src/services/pricingService.test.ts` | CREATED | new file |
| `core/src/services/taskService.nodeRuns.test.ts` | CREATED | new file |
| `core/src/services/wsService.ts` | UPDATED | +36 |
| `core/src/routes/pricing.ts` | CREATED | new file |
| `core/src/index.ts` | UPDATED | +2 |
| `core/src/agents/executor.ts` | UPDATED | +59 / -2 |
| `gui/src/lib/api.ts` | UPDATED | +18 |
| `gui/src/lib/cost.ts` | UPDATED | +73 / -11 (replace hardcoded constants with cached fetch) |
| `gui/src/types/index.ts` | UPDATED | +38 |

Total: **+540 / -11** across 12 files (per `git diff --stat`).

## Deviations from Plan

1. **Added `createdAt` field to `NodeRun` interface and `task_node_runs` schema.** Plan didn't list it explicitly, but every other entity in this codebase (`ToolCall`, `Comment`, `AgentText`) has one and the migration block needed something to default-fill. Non-breaking; consumers can ignore it.
2. **Extracted `finalizeNodeRun()` helper in `executor.ts`** instead of inlining the update+broadcast pair at three sites (no-op early return, success path, catch). DRY; same behavior.
3. **GUI `cost.ts` `calculateCost` uses sync fallback when cache not yet loaded** rather than awaiting the in-flight promise. Plan called this out in GOTCHA — preserves sync signature so existing callers don't need refactoring.

## Issues Encountered

1. **GateGuard hook** required fact-block presentations before every Edit/Write. No technical issue but added overhead per file. No code impact.
2. **Initial `getNodeRun` import in `executor.ts` was unused** — removed in a follow-up edit before final typecheck. Caught by visual review, not by tsc (`noUnusedLocals` not strict).
3. **Tests share live `data/tasks.db`** as flagged in the plan — handled with timestamp-suffixed test fixtures and `afterEach` cleanup of the in-test rows. The fixture project/task remain in the dev DB but use unique slugs/IDs so they can't collide across runs.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `core/src/services/pricingService.test.ts` | 9 | `calculateCostUsd` (zero/known/mixed/unknown/null/undefined model + Opus pricing differs), `getActivePricing` (returns copy + includes default) |
| `core/src/services/taskService.nodeRuns.test.ts` | 6 | insert→get round-trip, partial-patch update, INSERT OR REPLACE idempotency, listNodeRunsByTask ordering, JSON artifact round-trip, malformed JSON fallback |

## Next Steps
- [ ] Manual smoke: start `npm run dev` (core) + `pnpm dev` (gui), drag a task to `doing`, verify `task_node_runs` row appears via `sqlite3 core/data/tasks.db "SELECT id, taskId, nodeType, status, inputTokens, outputTokens FROM task_node_runs ORDER BY startedAt DESC LIMIT 5;"`. Verify `curl http://localhost:3001/api/pricing` returns the table.
- [ ] Code review via `/code-review`.
- [ ] Commit and create PR via `/prp-commit` + `/prp-pr`.
- [ ] Update PRD Phase 1 from `in-progress` to `complete` and link this report.
- [ ] Plan Phase 2 (Graph Runner MVP) via `/prp-plan` against the PRD.
