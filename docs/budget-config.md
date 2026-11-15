# Budget Configuration Guide

## Where the numbers come from

Every Claude CLI run reports its own cost in the final `result` event (`total_cost_usd`). ClauFlow records that figure; it does not price tokens itself for anything it shows as spent.

- **Task cost** (`tasks.costUsd`) is the task's lifetime spend: every role run, comment run and "Break down task" run adds its `total_cost_usd`. It is never reset. Cards, the list, the board stats, the drawer header and Insights show it.
- **Run cost** (`task_team_runs.costUsd`) is the spend of one team run. The budget is checked against this.
- **Planner cost** (`projects.planningCostUsd`) is the AI planner's spend for the project; it is not attributed to any task. Insights adds it to the project total.

## Default Task Budget

The default cap per run is set in `core/src/services/pricingService.ts`:

```ts
export const DEFAULT_TASK_BUDGET_USD = 2.0;
```

## Per-Project Override

Set a custom budget for all tasks in a project in the **project drawer** (edit the project, set **Budget (USD)**, save). This writes the `budgetUsd` column of the `projects` table. Runs already in progress keep the budget they started with.

## Per-Task Override

Open a task card, edit **Budget (USD)** in the drawer and save. Per-task budget takes precedence over the project budget, which takes precedence over the global default:

```
task.budgetUsd  >  project.budgetUsd  >  DEFAULT_TASK_BUDGET_USD
```

## How the budget is enforced

The budget applies **per team run**: a retry starts a new run with a fresh budget, while the task's lifetime cost keeps growing.

While a role runs, `core/src/agents/roleRunner.ts` keeps a running estimate (token usage of each turn × the role model's price from `MODEL_PRICING`; advisor spend is not counted, so the estimate is a lower bound). When the run's spend so far plus that estimate reaches the budget, or when the role's final `total_cost_usd` does, the role is aborted. The estimate only decides *when to stop*; the cost that gets recorded is always the CLI's reported figure.

## What Happens When Budget Is Exceeded

1. `broadcastBudgetExceeded` sends a `budget_exceeded` WebSocket event (`spentUsd`, `budgetUsd`, task title, display id, project); the GUI shows a toast.
2. The running role's Claude invocation is aborted.
3. The team run stops with reason `budget` (`core/src/agents/teamRunner.ts`), whatever the role's position in the team. The only exception is a QA round that already returned **PASS**: the work is delivered.
4. Uncommitted work on the branch is kept as a `wip:` commit; no PR is opened and nothing is committed as finished work.
5. The task returns to **Todo** with `agent.status: "error"` and `agent.error: "stuck_budget"`; the team summary comment states the spend against the budget.

Raise the budget and retry. The retry keeps the earlier branch as `<branch>-wip-N` when it carries commits.

## Pricing table

`MODEL_PRICING` in `pricingService.ts` is used only for the mid-run estimate above and for Insights rows from runs recorded before real costs were stored (shown with a `~`). `PRICING_UPDATED_AT` records when the table was last checked; `GET /api/pricing` returns it with `stale: true` once it is more than 90 days old. The GUI no longer shows a staleness banner, because displayed costs come from the CLI.

To update pricing:
1. Check current rates at https://docs.anthropic.com/en/docs/about-claude/models
2. Edit `MODEL_PRICING` in `core/src/services/pricingService.ts`
3. Update `PRICING_UPDATED_AT` to today's ISO date (e.g. `"2026-08-01"`)
4. Run `cd core && npm test` to verify no regressions
