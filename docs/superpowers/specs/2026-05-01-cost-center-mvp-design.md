# Cost Center MVP — Design

**Date:** 2026-05-01
**Status:** Approved (brainstorming)
**Owner:** @furkaanasik

## Goal

Give each project a per-month USD budget, a spend breakdown of completed tasks, and a per-task model override — so the user can see what they spent, what burned the most, and stop runaway spend before it happens.

## Non-Goals

- Cross-project aggregate dashboard (deferred — can be added on top of `/api/projects/:id/costs` later).
- Per-user / team accounting (single-user tool today).
- Persisting historical USD values. Token counts are persisted; USD is recomputed from current pricing on every read.
- Invoicing, billing exports, currency other than USD.

## Architecture

```
┌─────────────────────────┐    PATCH /api/projects/:id   ┌────────────────────┐
│  ProjectDetailDrawer    │ ──────────────────────────▶  │ projects.ts route  │
│  └── Costs tab          │                              └─────────┬──────────┘
│      ├── summary card   │                                        │
│      ├── sparkline      │  GET /api/projects/:id/costs           ▼
│      └── breakdown table│ ──────────────────────────▶  ┌────────────────────┐
└─────────────────────────┘                              │ taskService        │
                                                         │  + pricingService  │
                                                         └─────────┬──────────┘
                                                                   │
                                                            ┌──────▼──────┐
                                                            │  tasks.db   │
                                                            └─────────────┘
```

`pricingService` is the single source of truth for `tokens × model → USD`. It is pure (no DB), so unit tests are trivial.

## Data Model

`projects` table — three new columns (idempotent migration, same pattern as `taskService.ts:215`):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `monthlyBudgetUsd` | `REAL` | `NULL` | `NULL` = unlimited. |
| `defaultModel` | `TEXT` | `NULL` | `NULL` = global default (`claude-sonnet-4-6`). |
| `budgetEnforcement` | `TEXT NOT NULL` | `'warn'` | `'off' \| 'warn' \| 'block'`. |

`tasks` table — one new column:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `model` | `TEXT` | `NULL` | `NULL` = use project `defaultModel`. Persisted on first executor run for replay/audit. |

**No new tables.** Monthly spend is `SUM(usage * pricing) WHERE projectId = ? AND createdAt >= <month-start>`.

**Pricing** lives in `core/src/services/pricingService.ts`:

```ts
export const PRICING: Record<string, ModelRate> = {
  'claude-opus-4-7':   { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input:  3.00, output: 15.00, cacheRead: 0.30,  cacheWrite:  3.75 },
  'claude-haiku-4-5':  { input:  1.00, output:  5.00, cacheRead: 0.10,  cacheWrite:  1.25 },
};
```

**Tradeoff — dynamic vs frozen USD:** USD is recomputed from current pricing every read, not stored. If Anthropic changes prices, historical totals shift. Accepted because (a) Claude pricing rarely changes, (b) single source of truth simplifies reasoning, (c) zero migration work for existing rows. If frozen totals become important later, add a `costUsd` column on `tasks` and write through `pricingService.costForUsage` at task-completion time.

## API Surface

**Project routes (`core/src/routes/projects.ts`):**

- `PATCH /api/projects/:id` — accepts `monthlyBudgetUsd`, `defaultModel`, `budgetEnforcement`.
- `GET /api/projects/:id/costs?period=month` — returns:
  ```ts
  {
    period: { start: ISO, end: ISO },
    totalUsd: number,
    budgetUsd: number | null,
    enforcement: 'off' | 'warn' | 'block',
    breakdown: Array<{
      taskId: string, displayId: string, title: string,
      model: string, tokens: TaskUsage, costUsd: number,
      completedAt: ISO,
    }>,
    daily: Array<{ date: 'YYYY-MM-DD', costUsd: number }>,
  }
  ```

**Task routes (`core/src/routes/tasks.ts`):**

- `POST /api/tasks` — body accepts optional `model: string`.
- `PATCH /api/tasks/:id` — `model` is patchable.
- DOING transition guard: before flipping `status: 'doing'`, compute month spend. If `enforcement === 'block'` and `currentMonthTotal ≥ budget`, return **409** with `{ error: 'budget_exceeded', currentUsd, budgetUsd }`. UI shows a red toast and snaps the card back to TODO. (No next-task cost estimation — see Enforcement section for rationale.)

**WebSocket event:**

- `cost_update` — `{ projectId, totalUsd, budgetUsd, percentage }` — broadcast on task completion. UI live-updates the progress bar without refetch.

## UI

**Costs tab in `ProjectDetailDrawer`** (4th tab after Config / Agents / Skills):

- **Summary card** — `$12.34 / $50.00` large, progress bar (≥80% amber, ≥100% red). Inline gear icon → edit budget input, enforcement segmented control, default-model dropdown.
- **Sparkline** — last 30 days. Inline SVG, no new dependency.
- **Breakdown table** — `displayId | title | model | in/out/cache tokens | cost | date`. Sorted by cost desc by default.

**`AddTaskModal`** — new "Model" dropdown. Options: "Use project default (Sonnet 4.6)", Opus 4.7, Sonnet 4.6, Haiku 4.5.

**`Header`** — small cost badge next to WS status: "this month: $X". Hover shows per-project breakdown tooltip; click opens active project's Costs tab.

**i18n** — all strings under a new `costsTab.*` namespace, TR + EN.

## Enforcement

| Enforcement | DOING transition | UI |
|---|---|---|
| `off` | always allowed | no toast |
| `warn` | always allowed | yellow toast on every task once ≥80% |
| `block` | rejected with 409 once `total ≥ budget` | red toast + card snaps back to TODO |

The block check uses **current month total** (does not estimate next-task cost). This is intentionally simple — over-spend by one task is acceptable; over-spend by ten is not.

## Error Handling

- Unknown model in `pricingService` → `console.warn`, fall back to Sonnet rate, mark cell with `?` icon in the breakdown table.
- Budget set but enforcement `off` → silently ignored.
- Task `model` null AND project `defaultModel` null → executor uses `process.env.CLAUDE_DEFAULT_MODEL ?? 'claude-sonnet-4-6'`.
- Pricing fetch fails (n/a — pricing is static in code) — not a runtime concern.

## Testing

- `pricingService.test.ts` (vitest) — known token inputs × known models → expected USD, including unknown-model fallback.
- `taskService.test.ts` — `projectMonthSpend` aggregation correctness across month boundaries.
- Manual E2E — set budget to $0.10, run a task, observe block on the next.

## Migration

- Three `ALTER TABLE projects ADD COLUMN` + one on `tasks`, idempotent (try/catch around each, mirroring the existing `usage` columns migration in `taskService.ts:215`).
- Backward compat: existing rows have `NULL` budgets, `'warn'` enforcement default does not affect any existing flow until the user sets a budget.
- Historical tasks render USD via `pricingService` from their stored token counts. No backfill required.

## Out-of-Scope (explicitly deferred)

- `/costs` top-level page (cross-project view) — Approach 2 from brainstorm; revisit when a second user shows up.
- Per-task hard token cap / kill switch — different problem (rogue task), would belong to executor not pricing.
- Auto-downgrade ("retry a failed Opus task on Sonnet") — different problem (resilience).
- Cost forecasting / "you'll hit budget on the 23rd" — needs more data.

## File Touch List

**New:**
- `core/src/services/pricingService.ts`
- `core/src/services/pricingService.test.ts`
- `gui/src/components/Modals/CostsTab.tsx`

**Modified:**
- `core/src/types/index.ts` — `Project`, `Task` shapes; new WS event type.
- `core/src/services/taskService.ts` — migration, `projectMonthSpend`, `dailySpend`, model field on insert/update.
- `core/src/routes/projects.ts` — PATCH new fields + GET costs.
- `core/src/routes/tasks.ts` — model field, DOING block check.
- `core/src/agents/executor.ts` — model resolution chain, persist `model` on task.
- `core/src/services/wsService.ts` — `cost_update` broadcast.
- `gui/src/components/Modals/ProjectDetailDrawer.tsx` — 4th tab.
- `gui/src/components/Modals/AddTaskModal.tsx` — model dropdown.
- `gui/src/components/Layout/Header.tsx` — cost badge.
- `gui/src/lib/i18n/{en,tr,types}.ts` — `costsTab` namespace.
- `gui/src/lib/api.ts` — new endpoints.
- `gui/src/store/boardStore.ts` — cost state.
- `gui/src/hooks/useAgentSocket.ts` — `cost_update` handler.
