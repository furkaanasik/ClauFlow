# Plan: Fleet Dashboard (Phase 6)

## Summary
Add a `/insights` page that surfaces per-project and per-node-type telemetry (tokens, USD cost, completion rate, CI pass rate, time-to-green, error rate) already collected by Phases 1–5. Backend exposes a single `GET /api/insights` aggregate endpoint; frontend page follows the `/github` page pattern with local state and `fetch`. No new DB columns needed — all data already exists in `tasks` and `task_node_runs`.

## User Story
As a ClauFlow user, I want a dashboard that aggregates token spend, USD cost, and quality metrics for my project's tasks so that I can understand usage trends and trust that the agent pipeline is working.

## Problem → Solution
Data sits in `tasks` and `task_node_runs` but no UI surfaces it → new `GET /api/insights` route with aggregate SQL queries + `/insights` Next.js page that visualises summary stats, per-node-type breakdown, and recent task list with per-task cost + export to CSV/JSON.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/orchestration-ci-observability.prd.md`
- **PRD Phase**: Phase 6 — Fleet Dashboard
- **Estimated Files**: 8

---

## UX Design

### Before
```
No insights page. Users must query SQLite manually to see spend.
```

### After
```
/insights?projectId=<id>

┌─ Header ──────────────────────────────────────────────────────┐
│  ← Board   Fleet · <ProjectName>          [Export ▾]         │
└───────────────────────────────────────────────────────────────┘

┌─ Summary stats (4 cards) ─────────────────────────────────────┐
│  42 tasks   $3.28 total   83% done   67% CI pass rate         │
└───────────────────────────────────────────────────────────────┘

┌─ Per-node-type breakdown table ───────────────────────────────┐
│  Node Type  Runs  Done  Tokens    USD   Success %             │
│  planner    38    36    125 K    $0.37   94%                  │
│  coder      41    38    2.1 M   $2.45   92%                  │
│  ci         34    28    —        —      82%                  │
│  fix        12    9     310 K   $0.46   75%                  │
└───────────────────────────────────────────────────────────────┘

┌─ Recent tasks (last 20) ──────────────────────────────────────┐
│  #abc123  Add dark mode  done  2.4K tokens  $0.08  1m 42s    │
│  #def456  Fix auth bug   error 1.1K tokens  $0.03  —         │
└───────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Header right zone | no insights link | "Insights" link (always visible) | next to PRs link |
| Navigation | no `/insights` route | `gui/src/app/insights/page.tsx` | Next.js App Router |
| Export | n/a | "Export ▾" dropdown: JSON / CSV | calls `/api/insights/export` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/services/taskService.ts` | 1–40 | `db` export, migration pattern |
| P0 | `core/src/services/pricingService.ts` | 1–82 | `calculateCostUsd`, `MODEL_PRICING`, `DEFAULT_MODEL` |
| P0 | `gui/src/app/github/page.tsx` | all | Page pattern to mirror exactly |
| P0 | `core/src/index.ts` | 1–40 | Router mounting pattern |
| P1 | `core/src/routes/tasks.ts` | 1–35 | Route file structure + imports |
| P1 | `gui/src/lib/api.ts` | 1–65 | `api` object + `handle<T>()` pattern |
| P1 | `gui/src/components/Layout/Header.tsx` | 94–123 | Where to insert Insights nav link |
| P2 | `gui/src/lib/cost.ts` | all | `calculateCost`, `formatTokens` — reuse on frontend |

## External Documentation
N/A — feature uses established internal patterns only.

---

## Patterns to Mirror

### ROUTE_FILE_STRUCTURE
```ts
// SOURCE: core/src/routes/tasks.ts:1-32
import { Router, type Request, type Response } from "express";
import { errorMessage } from "../utils/error.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const result = someQuery();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
```

### DB_QUERY_PATTERN
```ts
// SOURCE: core/src/services/taskService.ts:37-38 + better-sqlite3 sync API
import { db } from "../services/taskService.js";

// Prepare at module level, call with .get() or .all()
const stmt = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE projectId = ?`);
const row = stmt.get(projectId) as { count: number };
```

### COST_CALCULATION_PATTERN
```ts
// SOURCE: core/src/services/pricingService.ts:60-77
import { calculateCostUsd, DEFAULT_MODEL } from "../services/pricingService.js";

const usd = calculateCostUsd(
  { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
  model ?? DEFAULT_MODEL,
);
```

### PAGE_COMPONENT_PATTERN
```tsx
// SOURCE: gui/src/app/github/page.tsx:1-50
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

function InsightsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) { setLoading(false); setError("No project."); return; }
    setLoading(true);
    api.getInsights(projectId)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);
  // ...render
}

export default function InsightsPage() {
  return <Suspense fallback={<Loading />}><InsightsContent /></Suspense>;
}
```

### NAV_LINK_PATTERN
```tsx
// SOURCE: gui/src/components/Layout/Header.tsx:114-123
{selectedProjectId && (
  <Link
    href={`/github?projectId=${selectedProjectId}`}
    className="flex h-9 items-center gap-2 px-3 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
    title="Pull Requests"
  >
    <GithubIcon className="h-4 w-4" />
    <span className="hidden text-[12px] md:inline">PRs</span>
  </Link>
)}
```

### API_CLIENT_PATTERN
```ts
// SOURCE: gui/src/lib/api.ts:52-65
export const api = {
  getTasks: async (projectId?: string): Promise<Task[]> => {
    const url = projectId
      ? `${BASE}/tasks?projectId=${encodeURIComponent(projectId)}`
      : `${BASE}/tasks`;
    return fetch(url, { cache: "no-store" }).then((r) => handle<{ tasks: Task[] }>(r))
      .then((d) => d.tasks ?? []);
  },
  // ... add getInsights the same way
};
```

### CSS_VARIABLES_PATTERN
```tsx
// SOURCE: gui/src/app/github/page.tsx:60-130
// Always use CSS variables, never raw colors or Tailwind color classes:
className="bg-[var(--bg-base)] text-[var(--text-primary)]"
className="border-[var(--border)]"
className="text-[var(--text-muted)]"
className="text-[var(--accent-primary)]"
className="bg-[var(--bg-surface)]"
className="bg-[var(--bg-elevated)]"
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/routes/insights.ts` | CREATE | New route: `GET /insights`, `GET /insights/export` |
| `core/src/index.ts` | UPDATE | Mount `insightsRouter` at `/api/insights` |
| `gui/src/app/insights/page.tsx` | CREATE | Next.js page at `/insights` route |
| `gui/src/lib/api.ts` | UPDATE | Add `getInsights(projectId)` and `exportInsights(projectId, format)` |
| `gui/src/components/Layout/Header.tsx` | UPDATE | Add Insights nav link in right-action zone |

## NOT Building
- Materialized views / scheduled rollups (not needed at current data scale; `<500ms` easily met with indexed queries for 1000-task projects)
- Real-time live-update WebSocket integration for insights (v1 fetches on page load only)
- Cross-project fleet view (per-project only in v1, as PRD scopes "per-project cards")
- Burn-rate alerts (Slack/email) — PRD marks this "Could"; defer to Phase 7 or later
- Grafana/external export — internal CSV/JSON only

---

## Step-by-Step Tasks

### Task 1: Create `core/src/routes/insights.ts`
- **ACTION**: Create route file with two endpoints: `GET /` (aggregate metrics) and `GET /export` (raw CSV/JSON)
- **IMPLEMENT**:
  ```ts
  import { Router, type Request, type Response } from "express";
  import { db } from "../services/taskService.js";
  import { calculateCostUsd, DEFAULT_MODEL } from "../services/pricingService.js";
  import { errorMessage } from "../utils/error.js";

  const router = Router();

  router.get("/", (req: Request, res: Response) => {
    try {
      const projectId = String(req.query.projectId ?? "");
      if (!projectId) { res.status(400).json({ error: "projectId required" }); return; }

      // Summary from tasks table
      const summaryRow = db.prepare(`
        SELECT
          COUNT(*) as totalTasks,
          SUM(CASE WHEN status IN ('done','review') THEN 1 ELSE 0 END) as doneTasks,
          SUM(CASE WHEN agentStatus = 'error' THEN 1 ELSE 0 END) as errorTasks,
          SUM(CASE WHEN prNumber IS NOT NULL THEN 1 ELSE 0 END) as prCount,
          SUM(COALESCE(inputTokens, 0)) as totalInputTokens,
          SUM(COALESCE(outputTokens, 0)) as totalOutputTokens,
          SUM(COALESCE(cacheReadTokens, 0)) as totalCacheReadTokens,
          SUM(COALESCE(cacheWriteTokens, 0)) as totalCacheWriteTokens,
          AVG(CASE
            WHEN agentStartedAt IS NOT NULL AND agentFinishedAt IS NOT NULL
            THEN (julianday(agentFinishedAt) - julianday(agentStartedAt)) * 86400000.0
            ELSE NULL END) as avgTimeToGreenMs
        FROM tasks WHERE projectId = ?
      `).get(projectId) as SummaryRow;

      // Per-node-type from task_node_runs (JOIN tasks for projectId scope)
      const nodeRows = db.prepare(`
        SELECT
          nr.nodeType,
          nr.model,
          COUNT(*) as runCount,
          SUM(CASE WHEN nr.status = 'done' THEN 1 ELSE 0 END) as doneCount,
          SUM(nr.inputTokens) as inputTokens,
          SUM(nr.outputTokens) as outputTokens,
          SUM(nr.cacheReadTokens) as cacheReadTokens,
          SUM(nr.cacheWriteTokens) as cacheWriteTokens
        FROM task_node_runs nr
        JOIN tasks t ON t.id = nr.taskId
        WHERE t.projectId = ?
        GROUP BY nr.nodeType, nr.model
      `).all(projectId) as NodeAggRow[];

      // CI metrics
      const ciRow = db.prepare(`
        SELECT
          SUM(CASE WHEN nr.nodeType = 'ci' AND nr.status = 'done' THEN 1 ELSE 0 END) as ciDone,
          SUM(CASE WHEN nr.nodeType = 'ci' THEN 1 ELSE 0 END) as ciTotal
        FROM task_node_runs nr
        JOIN tasks t ON t.id = nr.taskId
        WHERE t.projectId = ?
      `).get(projectId) as { ciDone: number; ciTotal: number };

      // Recent tasks (last 20)
      const recentRows = db.prepare(`
        SELECT
          t.id, t.title, t.status, t.agentStatus, t.createdAt,
          COALESCE(t.inputTokens,0) as inputTokens,
          COALESCE(t.outputTokens,0) as outputTokens,
          COALESCE(t.cacheReadTokens,0) as cacheReadTokens,
          COALESCE(t.cacheWriteTokens,0) as cacheWriteTokens,
          t.agentStartedAt, t.agentFinishedAt,
          COUNT(nr.id) as nodeRunCount
        FROM tasks t
        LEFT JOIN task_node_runs nr ON nr.taskId = t.id
        WHERE t.projectId = ?
        GROUP BY t.id
        ORDER BY t.createdAt DESC
        LIMIT 20
      `).all(projectId) as RecentRow[];

      // Compute USD costs in JS (model-aware)
      const summaryUsd = calculateCostUsd({
        inputTokens: summaryRow.totalInputTokens,
        outputTokens: summaryRow.totalOutputTokens,
        cacheReadTokens: summaryRow.totalCacheReadTokens,
        cacheWriteTokens: summaryRow.totalCacheWriteTokens,
      }, DEFAULT_MODEL);

      // Aggregate nodeRows by nodeType (multiple model entries → one entry per type)
      const byNodeType = aggregateByNodeType(nodeRows);

      const recentTasks = recentRows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        agentStatus: r.agentStatus,
        createdAt: r.createdAt,
        estimatedUsd: calculateCostUsd(
          { inputTokens: r.inputTokens, outputTokens: r.outputTokens,
            cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens },
          DEFAULT_MODEL,
        ),
        timeToGreenMs: r.agentStartedAt && r.agentFinishedAt
          ? new Date(r.agentFinishedAt).getTime() - new Date(r.agentStartedAt).getTime()
          : null,
        nodeRunCount: r.nodeRunCount,
      }));

      res.json({
        projectId,
        summary: {
          totalTasks: summaryRow.totalTasks,
          doneTasks: summaryRow.doneTasks,
          errorTasks: summaryRow.errorTasks,
          prCount: summaryRow.prCount,
          totalInputTokens: summaryRow.totalInputTokens,
          totalOutputTokens: summaryRow.totalOutputTokens,
          totalCacheReadTokens: summaryRow.totalCacheReadTokens,
          totalCacheWriteTokens: summaryRow.totalCacheWriteTokens,
          estimatedUsd: summaryUsd,
          avgTimeToGreenMs: summaryRow.avgTimeToGreenMs ?? null,
          ciPassRate: ciRow.ciTotal > 0 ? ciRow.ciDone / ciRow.ciTotal : null,
        },
        byNodeType,
        recentTasks,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.get("/export", (req: Request, res: Response) => {
    try {
      const projectId = String(req.query.projectId ?? "");
      const format = String(req.query.format ?? "json");
      if (!projectId) { res.status(400).json({ error: "projectId required" }); return; }

      const rows = db.prepare(`
        SELECT t.id, t.title, t.status, t.agentStatus, t.createdAt,
          COALESCE(t.inputTokens,0) as inputTokens,
          COALESCE(t.outputTokens,0) as outputTokens,
          COALESCE(t.cacheReadTokens,0) as cacheReadTokens,
          COALESCE(t.cacheWriteTokens,0) as cacheWriteTokens,
          t.agentStartedAt, t.agentFinishedAt, t.prNumber
        FROM tasks t WHERE t.projectId = ? ORDER BY t.createdAt DESC
      `).all(projectId) as ExportRow[];

      if (format === "csv") {
        const header = "id,title,status,agentStatus,createdAt,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,agentStartedAt,agentFinishedAt,prNumber\n";
        const lines = rows.map((r) =>
          [r.id, `"${r.title.replace(/"/g, '""')}"`, r.status, r.agentStatus,
           r.createdAt, r.inputTokens, r.outputTokens, r.cacheReadTokens,
           r.cacheWriteTokens, r.agentStartedAt ?? "", r.agentFinishedAt ?? "",
           r.prNumber ?? ""].join(","),
        ).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="insights-${projectId}.csv"`);
        res.send(header + lines);
      } else {
        res.setHeader("Content-Disposition", `attachment; filename="insights-${projectId}.json"`);
        res.json(rows);
      }
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  interface SummaryRow {
    totalTasks: number; doneTasks: number; errorTasks: number; prCount: number;
    totalInputTokens: number; totalOutputTokens: number;
    totalCacheReadTokens: number; totalCacheWriteTokens: number;
    avgTimeToGreenMs: number | null;
  }
  interface NodeAggRow {
    nodeType: string; model: string | null; runCount: number; doneCount: number;
    inputTokens: number; outputTokens: number;
    cacheReadTokens: number; cacheWriteTokens: number;
  }
  interface RecentRow {
    id: string; title: string; status: string; agentStatus: string; createdAt: string;
    inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
    agentStartedAt: string | null; agentFinishedAt: string | null; nodeRunCount: number;
  }
  interface ExportRow {
    id: string; title: string; status: string; agentStatus: string; createdAt: string;
    inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
    agentStartedAt: string | null; agentFinishedAt: string | null; prNumber: number | null;
  }

  function aggregateByNodeType(rows: NodeAggRow[]) {
    const map = new Map<string, { nodeType: string; runCount: number; doneCount: number;
      inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; estimatedUsd: number }>();
    for (const r of rows) {
      const existing = map.get(r.nodeType);
      const usd = calculateCostUsd(
        { inputTokens: r.inputTokens, outputTokens: r.outputTokens,
          cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens },
        r.model,
      );
      if (existing) {
        existing.runCount += r.runCount; existing.doneCount += r.doneCount;
        existing.inputTokens += r.inputTokens; existing.outputTokens += r.outputTokens;
        existing.cacheReadTokens += r.cacheReadTokens; existing.cacheWriteTokens += r.cacheWriteTokens;
        existing.estimatedUsd += usd;
      } else {
        map.set(r.nodeType, { nodeType: r.nodeType, runCount: r.runCount, doneCount: r.doneCount,
          inputTokens: r.inputTokens, outputTokens: r.outputTokens,
          cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens,
          estimatedUsd: usd });
      }
    }
    return Array.from(map.values());
  }

  export default router;
  ```
- **MIRROR**: ROUTE_FILE_STRUCTURE, DB_QUERY_PATTERN, COST_CALCULATION_PATTERN
- **IMPORTS**: `Router`, `Request`, `Response` from `express`; `db` from `../services/taskService.js`; `calculateCostUsd`, `DEFAULT_MODEL` from `../services/pricingService.js`; `errorMessage` from `../utils/error.js`
- **GOTCHA**: `task_node_runs` has no `projectId` column — always JOIN through `tasks`. All token columns can be NULL on old rows — use `COALESCE(..., 0)`. The `model` column on `task_node_runs` can be NULL; pass it through to `calculateCostUsd` which falls back to `DEFAULT_MODEL`.
- **VALIDATE**: `curl "http://localhost:3001/api/insights?projectId=<id>"` returns a JSON object with `summary`, `byNodeType`, `recentTasks` keys; no 500.

### Task 2: Mount route in `core/src/index.ts`
- **ACTION**: Import and mount `insightsRouter` at `/api/insights`
- **IMPLEMENT**:
  ```ts
  // After existing imports:
  import insightsRouter from "./routes/insights.js";
  // After existing mounts (e.g., after pricingRouter):
  app.use("/api/insights", insightsRouter);
  ```
- **MIRROR**: ROUTE_FILE_STRUCTURE (mounting pattern from index.ts lines 26–34)
- **IMPORTS**: Add one import line + one `app.use()` line
- **GOTCHA**: Import uses `.js` extension (ESM). Order doesn't matter — no middleware dependency.
- **VALIDATE**: `npm run typecheck` in `core/` passes; server starts; `curl http://localhost:3001/api/insights` returns 400 "projectId required" (not 404).

### Task 3: Add `getInsights` and `exportInsights` to `gui/src/lib/api.ts`
- **ACTION**: Append two methods to the `api` export object
- **IMPLEMENT**:
  ```ts
  // Add InsightsData interface before the api object:
  export interface InsightsByNodeType {
    nodeType: string;
    runCount: number;
    doneCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedUsd: number;
  }
  export interface InsightsRecentTask {
    id: string;
    title: string;
    status: string;
    agentStatus: string;
    createdAt: string;
    estimatedUsd: number;
    timeToGreenMs: number | null;
    nodeRunCount: number;
  }
  export interface InsightsSummary {
    totalTasks: number;
    doneTasks: number;
    errorTasks: number;
    prCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    estimatedUsd: number;
    avgTimeToGreenMs: number | null;
    ciPassRate: number | null;
  }
  export interface InsightsData {
    projectId: string;
    summary: InsightsSummary;
    byNodeType: InsightsByNodeType[];
    recentTasks: InsightsRecentTask[];
  }

  // Inside the api object, after existing methods:
  getInsights: (projectId: string): Promise<InsightsData> =>
    fetch(`${BASE}/insights?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((r) => handle<InsightsData>(r)),

  getInsightsExportUrl: (projectId: string, format: "csv" | "json"): string =>
    `${BASE}/insights/export?projectId=${encodeURIComponent(projectId)}&format=${format}`,
  ```
- **MIRROR**: API_CLIENT_PATTERN
- **IMPORTS**: No new imports needed — `handle<T>` and `BASE` already in scope
- **GOTCHA**: Export is a direct browser download (not a fetch — the caller opens the URL with `window.open`). Return the URL string rather than fetching the blob to avoid large buffer in memory.
- **VALIDATE**: `pnpm typecheck` in `gui/` passes; no new lint errors.

### Task 4: Add Insights nav link to `Header.tsx`
- **ACTION**: Insert an Insights link in the right-action zone, always visible (not gated on `selectedProjectId`)
- **IMPLEMENT**:
  ```tsx
  // After the PRs link block (line ~123), before the lang toggle button:
  <Link
    href={selectedProjectId ? `/insights?projectId=${selectedProjectId}` : "/insights"}
    className="flex h-9 items-center gap-2 px-3 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
    title="Insights"
  >
    <InsightsIcon className="h-4 w-4" />
    <span className="hidden text-[12px] md:inline">Insights</span>
  </Link>
  ```
  Add `InsightsIcon` as a local SVG component at the bottom of the file (follow `GithubIcon` / `SunIcon` pattern — small SVG functional component):
  ```tsx
  function InsightsIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 12 L5 8 L8 10 L11 5 L14 7" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="1" y="1" width="14" height="14" rx="1" />
      </svg>
    );
  }
  ```
- **MIRROR**: NAV_LINK_PATTERN
- **IMPORTS**: `Link` already imported
- **GOTCHA**: Header.tsx has `"use client"` at line 1. Do not add imports from server modules.
- **VALIDATE**: Dev server running; Insights link appears in header; clicking it navigates to `/insights?projectId=...`.

### Task 5: Create `gui/src/app/insights/page.tsx`
- **ACTION**: Create the `/insights` page following the `github/page.tsx` pattern exactly
- **IMPLEMENT**: Full page component with:
  1. `"use client"` directive
  2. `InsightsContent` inner component (wrapped in `<Suspense>`)
  3. Read `projectId` from `useSearchParams()`
  4. `useEffect` → `api.getInsights(projectId)` → local state `data/loading/error`
  5. Sticky header with `← Board` link and export dropdown button
  6. 4 summary stat cards: Total Tasks, USD Cost, Completion Rate, CI Pass Rate (each in a bordered card with `var(--bg-surface)`)
  7. Per-node-type breakdown table (nodeType, Runs, Done, Tokens, USD, Success%)
  8. Recent tasks list (last 20 rows, same row structure as PR list in github page)
  9. Export dropdown: clicking "JSON" calls `window.open(api.getInsightsExportUrl(projectId, 'json'))`, same for "CSV"
  
  Key UI details:
  - Loading state: three animated dots (copy from github page lines 96–104)
  - Error state: red bordered div (copy from github page lines 107–111)
  - Empty state: dashed border centered message
  - Tokens: use `formatTokens(inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens)` from `@/lib/cost`
  - USD: `cost.toFixed(4)` for per-task, `cost.toFixed(2)` for summary
  - Time-to-green: format as `Xm Ys` or `Xs` (simple inline helper)
  - Success %: `(doneCount / runCount * 100).toFixed(0) + "%"` — show `—` when runCount is 0
  - CI pass rate: show `—` when `ciPassRate` is null (no CI nodes ran yet)
  
- **MIRROR**: PAGE_COMPONENT_PATTERN, CSS_VARIABLES_PATTERN
- **IMPORTS**: `"use client"`, `useEffect`, `useState` from `react`; `Suspense` from `react`; `useSearchParams` from `next/navigation`; `Link` from `next/link`; `{ api, type InsightsData }` from `@/lib/api`; `{ formatTokens }` from `@/lib/cost`
- **GOTCHA**: Must wrap in `<Suspense>` because `useSearchParams()` requires it in Next.js 15 App Router (same as github page). CSS uses `var(--...)` never raw Tailwind color classes. `window.open` for export — no `ConfirmDialog` needed (non-destructive). `formatTokens` is imported from `@/lib/cost` not `@/lib/api`.
- **VALIDATE**: Dev server running. Navigate to `/insights?projectId=<real-id>` → data renders. Navigate to `/insights` (no projectId) → clear "No project selected" error state. Export JSON button opens download.

---

## Testing Strategy

No test infrastructure exists in the repo — do not add tests (per CLAUDE.md rule: "Do not add tests if there are none — only add them when asked").

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
```
EXPECT: Zero type errors

```bash
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

```bash
cd gui && pnpm lint
```
EXPECT: No new lint errors

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: Both build clean

### Manual Validation
- [ ] `cd core && npm run dev` starts without error
- [ ] `curl "http://localhost:3001/api/insights?projectId=MISSING"` → 400 `{"error":"projectId required"}`
- [ ] `curl "http://localhost:3001/api/insights?projectId=<real-id>"` → JSON with `summary`, `byNodeType`, `recentTasks`
- [ ] `curl "http://localhost:3001/api/insights/export?projectId=<real-id>&format=csv"` → CSV download
- [ ] `cd gui && pnpm dev` starts without error
- [ ] Navigate to `/insights?projectId=<real-id>` → page loads, stats render
- [ ] Navigate to `/insights` (no projectId) → error state renders, no crash
- [ ] Insights link visible in header; pre-fills projectId when project selected on board
- [ ] "Export JSON" and "Export CSV" buttons open browser downloads
- [ ] Project with zero tasks → empty states render, no NaN/undefined in UI

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] `npm run typecheck` and `pnpm typecheck` pass with zero errors
- [ ] `pnpm lint` passes with no new errors
- [ ] `/api/insights?projectId=<id>` returns valid JSON with all three top-level keys
- [ ] `/insights` page renders summary, breakdown table, recent tasks
- [ ] Export CSV and JSON download correctly
- [ ] Insights link in header navigates to `/insights?projectId=...`
- [ ] Empty/null states handled without crashes or NaN

## Completion Checklist
- [ ] Code follows discovered patterns (route file, page component, api client)
- [ ] Error handling: 400 for missing projectId, 500 with `errorMessage` for DB errors
- [ ] No hardcoded project IDs, prices, or model names
- [ ] CSS variables only (no raw color values or Tailwind color classes)
- [ ] No `window.confirm` — export uses `window.open`, no destructive actions
- [ ] Both `core/` and `gui/` use their respective package managers (`npm` vs `pnpm`)
- [ ] No new test files added
- [ ] No comments added to source files

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Query slow on large DB (1000+ tasks with many node_runs) | L | M | The index `idx_node_runs_task_started` covers the JOIN; 1000-task project well within SQLite sync range |
| `task_node_runs` rows missing for legacy single-node tasks | M | L | `LEFT JOIN` already used for recentTasks; summary falls back to tasks table which always has token totals |
| `model` column NULL on old node_runs → cost undercount | M | L | `calculateCostUsd` falls back to `DEFAULT_MODEL` — documented behaviour, acceptable approximation |
| `agentStartedAt`/`agentFinishedAt` NULL for legacy tasks | M | L | `AVG` with `CASE WHEN ... IS NOT NULL` skips NULLs; frontend shows `—` when null |

## Notes
- The `byNodeType` aggregation groups first by `(nodeType, model)` in SQL (multiple models per type possible), then merges to one entry per nodeType in `aggregateByNodeType()`. This avoids summing token costs with different per-token prices.
- `estimatedUsd` on the summary is computed from task-level totals (not node_runs sum) to avoid double-counting on legacy single-node tasks where node_runs may not exist. For projects using graph runner, both approaches agree because `task_node_runs` tokens sum to `tasks` tokens.
- Phase 7 will add a "pricing staleness warning" if `MODEL_PRICING` config is >90 days old — the `/insights` page is the natural place to surface it; leave a TODO comment in the summary card area for Phase 7.
