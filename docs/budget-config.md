# Budget Configuration Guide

## Default Task Budget

Every task runs with a cost cap. The default is set in `core/src/services/pricingService.ts`:

```ts
export const DEFAULT_TASK_BUDGET_USD = 2.0;
```

When a task's cumulative token spend crosses this threshold, the executor broadcasts a `budget_exceeded` event and aborts the agent via `controller.abort()`. The task moves to **Todo** with `agent.status: error`.

## Per-Project Override

Set a custom budget for all tasks in a project via the **Project Settings** panel:

1. Open the board → click the project name → **Project Details**
2. Edit the **Budget (USD)** field
3. Save — all new tasks in this project inherit the new limit

This writes to the `budgetUsd` column in the `projects` table. Existing in-flight tasks are not affected.

## Per-Task Override

Override the budget for a single task in the **Task Detail** drawer:

1. Click a task card to open the drawer
2. Edit the **Budget (USD)** field
3. Save

Per-task budget takes precedence over the project budget, which takes precedence over the global default.

Precedence order (highest wins):
```
task.budgetUsd  >  project.budgetUsd  >  DEFAULT_TASK_BUDGET_USD
```

## What Happens When Budget Is Exceeded

1. `broadcastBudgetExceeded` fires a `budget_exceeded` WebSocket event to the GUI
2. The GUI shows a red banner on the task card
3. `controller.abort()` is called — the current Claude invocation is killed
4. The task status returns to `todo` with `agent.status: error` and an error message noting the budget

The task can be retried after raising its budget.

## Pricing Staleness

Cost estimates depend on the hardcoded pricing table in `pricingService.ts`. The constant `PRICING_UPDATED_AT` records when the table was last verified against Anthropic's published rates.

If `PRICING_UPDATED_AT` is more than 90 days old, the Insights page shows a warning banner and `GET /api/pricing` returns `stale: true`.

To update pricing:
1. Check current rates at https://docs.anthropic.com/en/docs/about-claude/models
2. Edit `MODEL_PRICING` in `core/src/services/pricingService.ts`
3. Update `PRICING_UPDATED_AT` to today's ISO date (e.g. `"2026-08-01"`)
4. Run `cd core && npm test` to verify no regressions
