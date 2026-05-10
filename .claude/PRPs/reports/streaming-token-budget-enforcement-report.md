# Implementation Report: Streaming Token Budget Enforcement

## Summary
Added `onUsage` callback to the stream parser so executor and graphRunner accumulate token costs per assistant turn and call `controller.abort()` the moment the budget is crossed — instead of checking post-run via `onResult`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Files Changed | 3 | 3 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Add `onUsage` to `StreamJsonParserHandlers` + `ClaudeRunOptions` | Complete | |
| 2 | Extract per-turn usage in `createStreamJsonParser` | Complete | |
| 3 | Wire `onUsage` through `runClaudeOnce` | Complete | |
| 4 | Mid-run budget enforcement in `executor.ts` | Complete | `onClaudeResult` simplified to final-sync write only (budget check moved to `onUsageTurn`) |
| 5 | Mid-run budget enforcement in `graphRunner.ts` | Complete | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | Pass | Zero errors |
| Build | Pass | Clean build |
| Unit Tests | N/A | No existing test suite in core/ |
| Integration | Manual — see plan |  |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `core/src/services/claudeService.ts` | UPDATED | `onUsage` in `StreamJsonParserHandlers`, `ClaudeRunOptions`, `createStreamJsonParser`, `runClaudeOnce` |
| `core/src/agents/executor.ts` | UPDATED | `ClaudeUsage` import, `midRunUsage` accumulator, `onUsageTurn`, wired to `runClaude` |
| `core/src/agents/graphRunner.ts` | UPDATED | `ClaudeUsage` import, `cumulativeUsage` typed, `onUsageTurn`, wired to `runClaude` |

## Deviations from Plan
- `executor.ts` `onClaudeResult`: removed the budget check from the final-result handler since `onUsageTurn` now handles it mid-run. Final handler retained for authoritative usage write only. This is safe — if abort already happened the final write is a no-op in practice.

## Issues Encountered
None.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
