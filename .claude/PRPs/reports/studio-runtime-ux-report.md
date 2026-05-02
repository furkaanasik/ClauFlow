# Implementation Report: Phase 3 — Studio Runtime UX

## Summary

Make graph runs observable + recoverable from the Studio canvas. Three pillars:
1. Run-trace overlay — `node_started/finished/log` WS events drive a per-node status ring on `AgentNode`, plus a side `NodeRunPanel` showing run metadata + live log.
2. Per-node abort/retry — new endpoints `POST /api/tasks/:id/nodes/:nodeId/abort` and `…/retry`. Retry resumes the chain from the named node forward, seeding `prior` artifact from prior `done` row.
3. Save-time graph validation — `PUT /api/projects/:id/claude/graph` now runs `planGraph()` before disk write, returning `400 graph_invalid { reason, offendingNodeIds }` for cyclic/branching/etc topologies. UI surfaces a banner + per-node ring on offenders.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Files | ~10 | 12 (server: 5, gui: 7) |
| LOC | 500–650 | ~520 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Extend `GraphValidationError` with `offendingNodeIds` | ✅ | Captures node IDs for all 5 reasons |
| 2 | `RunGraphOptions.resumeFromNodeId` in `runGraph` | ✅ | Seeds `prior` from last `done` row's `outputArtifact` |
| 3 | `enqueueResume` in executor | ✅ | Threaded `EnqueueOptions` through `enqueue` → `run` → `runGraph` |
| 4 | Per-node abort/retry routes | ✅ | 404/400/409 envelope mirroring whole-task routes |
| 5 | `planGraph` validation in PUT graph | ✅ | Empty graph still allowed (Phase 2 parity) |
| 6 | `nodeRuns`/`nodeLogs` slice in `boardStore` | ✅ | Cap 500 lines per node, last-write-wins by `nodeId` |
| 7 | WS dispatch arms (`node_started/finished/log`) | ✅ | Three new switch cases mirroring `agent_log` shape |
| 8 | `AgentNode` runState + buttons | ✅ | Status ring + Abort (running) / Retry (error\|aborted) |
| 9 | `NodeRunPanel` (new) | ✅ | Right-side aside; tokens, model, timestamps, log |
| 10 | Wire abort/retry through API | ✅ | `api.abortNode`, `api.retryNode` + `ApiError` class |
| 11 | `taskId` entry point | ✅ | `StudioSegmentNew` reads `useSearchParams().get("taskId")` |
| 12 | graphRunner unit tests | ✅ | 4 new cases for `offendingNodeIds` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | ✅ Pass | core `tsc` + gui `tsc` clean |
| Lint | ✅ Pass | gui ESLint: no warnings or errors |
| Unit Tests | ✅ Pass | 57/57 passed (was 53; +4 new cases) |
| Build (core) | ✅ Pass | `tsc -p tsconfig.json` clean |
| Build (gui) | ✅ Pass | `next build` 7/7 pages |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `core/src/agents/graphRunner.ts` | UPDATE | `GraphValidationError.offendingNodeIds`, `RunGraphOptions.resumeFromNodeId`, resume seeding |
| `core/src/agents/executor.ts` | UPDATE | `EnqueueOptions`, `enqueueResume`, threaded through `run` → `runGraph` |
| `core/src/routes/tasks.ts` | UPDATE | `POST /:id/nodes/:nodeId/abort` + `…/retry` |
| `core/src/routes/projectsClaude.ts` | UPDATE | `planGraph` validation in `PUT /claude/graph` |
| `core/src/agents/graphRunner.test.ts` | UPDATE | +4 tests for `offendingNodeIds` |
| `gui/src/lib/api.ts` | UPDATE | `ApiError` class, `abortNode`, `retryNode` |
| `gui/src/store/boardStore.ts` | UPDATE | `nodeRuns`, `nodeLogs` slices + `upsertNodeRun`/`appendNodeLog`/`clearNodeRuns` |
| `gui/src/hooks/useAgentSocket.ts` | UPDATE | 3 new dispatch arms |
| `gui/src/components/Studio/AgentNode.tsx` | UPDATE | `runState`/`validationError` + abort/retry buttons + status ring |
| `gui/src/components/Studio/StudioCanvas.tsx` | UPDATE | `taskId` prop, enrichedNodes, validation banner, panel mount |
| `gui/src/components/Studio/NodeRunPanel.tsx` | CREATE | Right-side run inspector |
| `gui/src/components/Modals/ClaudeConfigTab.tsx` | UPDATE | `useSearchParams("taskId")` → `<StudioCanvas>` |

## Deviations from Plan

- **Plan Task 11**: plan said "edit `gui/src/app/board/page.tsx`". Actual mount of `StudioCanvas` happens inside `ClaudeConfigTab`'s `StudioSegmentNew` helper (board page hosts it indirectly via `ProjectDetailDrawer`). I read `useSearchParams` directly inside `StudioSegmentNew` — same effect, simpler than prop-drilling through the drawer.
- Status colors: plan suggested `var(--status-running)` etc. tokens; codebase uses Tailwind's blue/emerald/rose/amber for status semantics. Used those for clarity and to match existing badge styling.
- Did not add an "Open in Studio" link from `TaskDetailDrawer` — discoverability point left for a follow-up; running tasks already auto-show telemetry in the drawer log.

## Issues Encountered

None blocking. The `core/src/services/wsService.ts:148-174` events were already always-broadcast since Phase 2, so no server gating to remove.

## Tests Written

| Test File | New Tests | Coverage |
|---|---|---|
| `core/src/agents/graphRunner.test.ts` | 4 | `offendingNodeIds` for `multiple_entries`, `branching`, `cycle`, `disconnected/multiple_entries` |

## Next Steps

- [ ] `/code-review` then `/prp-pr`
- [ ] (Optional) Phase 4 plan already exists at `.claude/PRPs/plans/ci-gate-fix-loop.plan.md` — paralleled with this phase per PRD
