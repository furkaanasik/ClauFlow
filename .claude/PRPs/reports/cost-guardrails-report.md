# Implementation Report: Cost Guardrails (Phase 5)

## Summary
Per-task USD budget enforcement added to ClauFlow. Graph runs now check cumulative spend after each token update; when budget is hit, the run aborts and broadcasts a `budget_exceeded` WS event. Task drawer gains a budget progress bar; project settings gain a `budgetUsd` override field.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | High | High |
| Files Changed | 13 | 13 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Add DEFAULT_TASK_BUDGET_USD to pricingService | ✅ Complete | |
| 2 | DB migrations — budgetUsd columns | ✅ Complete | |
| 3 | Expose budgetUsd in taskService CRUD + getTaskEffectiveBudget | ✅ Complete | |
| 4 | Update core types — Project + WsMessage | ✅ Complete | |
| 5 | Add broadcastBudgetExceeded to wsService | ✅ Complete | |
| 6 | Budget check in graphRunner.ts | ✅ Complete | Model resolved from agent.frontmatter.model |
| 7 | Budget check in executor.ts (legacy path) | ✅ Complete | |
| 8 | Project route — accept budgetUsd | ✅ Complete | |
| 9 | Mirror types in gui | ✅ Complete | |
| 10 | Update gui/src/lib/api.ts | ✅ Complete | updateProject already passed full patch |
| 11 | boardStore — budgetExceeded state slice | ✅ Complete | |
| 12 | useAgentSocket — budget_exceeded case | ✅ Complete | |
| 13 | TaskDetailDrawer — budget progress bar | ✅ Complete | |
| 14 | ProjectDetailDrawer — budgetUsd input | ✅ Complete | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (core) | ✅ Pass | Zero type errors |
| Static Analysis (gui) | ✅ Pass | Zero type errors |
| Lint | ✅ Pass | No ESLint warnings or errors |
| Build (core) | ✅ Pass | |
| Build (gui) | ✅ Pass | |
| Unit Tests | N/A | No test suite configured |
| Integration | Manual | See manual checklist in plan |

## Files Changed

| File | Action |
|---|---|
| `core/src/services/pricingService.ts` | UPDATED — `DEFAULT_TASK_BUDGET_USD = 2.0` |
| `core/src/services/taskService.ts` | UPDATED — migrations, CRUD, `getTaskEffectiveBudget` |
| `core/src/types/index.ts` | UPDATED — `Project.budgetUsd`, `budget_exceeded` WsMessage |
| `core/src/services/wsService.ts` | UPDATED — `broadcastBudgetExceeded` |
| `core/src/agents/graphRunner.ts` | UPDATED — budget check in `onClaudeResult` |
| `core/src/agents/executor.ts` | UPDATED — budget check in `onClaudeResult` |
| `core/src/routes/projects.ts` | UPDATED — `budgetUsd` in Zod schemas + handlers |
| `gui/src/types/index.ts` | UPDATED — mirrored `Project.budgetUsd`, `budget_exceeded` |
| `gui/src/lib/api.ts` | UPDATED — `budgetUsd` in `CreateProjectInput` |
| `gui/src/store/boardStore.ts` | UPDATED — `budgetExceeded` slice + `setBudgetExceeded` |
| `gui/src/hooks/useAgentSocket.ts` | UPDATED — `budget_exceeded` case + toast |
| `gui/src/components/Card/TaskDetailDrawer.tsx` | UPDATED — budget progress bar |
| `gui/src/components/Modals/ProjectDetailDrawer.tsx` | UPDATED — `budgetUsd` input field |

## Deviations from Plan
- Task 6: Model resolved from `agent.frontmatter.model` (the graphRunner's agent definition) rather than `task.agent?.model` since task-level model field doesn't exist on the Task type. Functionally equivalent with `DEFAULT_MODEL` fallback.
- Task 13: Budget progress bar placed in drawer footer area near costPill rather than details tab body (costPill is in the footer, not a tab).

## Issues Encountered
None — both agents completed cleanly on first pass.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Manual validation: create project with `budgetUsd = 0.01`, drag task to doing, verify abort + toast + red bar
