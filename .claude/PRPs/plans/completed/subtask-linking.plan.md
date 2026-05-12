# Plan: Subtask Linking

## Summary
Add a `parentTaskId` field to the task schema so that when "Break down task" runs, the generated subtasks are linked back to the parent task. The parent task drawer gains a "Subtasks" section that lists all child tasks with their status, allowing navigation directly to each subtask.

## User Story
As a developer, I want subtasks created from a breakdown to reference their parent task, so that I can see all related subtasks in the parent's drawer and understand the breakdown structure.

## Problem → Solution
Currently `taskBreakdownRunner` creates subtasks and moves the parent to `nothing`, but no `parentTaskId` column exists → subtasks have no recorded relation to the parent. Add `parentTaskId TEXT REFERENCES tasks(id)` to the DB, pass it during creation, expose it in the API, and render a "Subtasks" section in `TaskDetailDrawer`.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 7

---

## UX Design

### Before
```
TaskDetailDrawer (details tab)
 ├ 01 Description
 ├ 02 Analysis
 ├ 03 Break down task…
 ├ 04 Execution mode
 └ 05 Danger zone
```

### After
```
TaskDetailDrawer (details tab)
 ├ 01 Description
 ├ 02 Analysis
 ├ 03 Subtasks  ← NEW (visible only on tasks with parentTaskId=null that have children)
 │    ├ PROJ-4 Add login endpoint  [todo]
 │    ├ PROJ-5 Add logout endpoint [doing]
 │    └ PROJ-6 Write auth tests    [done]
 ├ 04 Break down task…
 ├ 05 Execution mode
 └ 06 Danger zone
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Breakdown completes | Parent moves to `nothing`; subtasks created | Same + subtasks carry `parentTaskId` | No visible change at creation time |
| Parent task drawer (details tab) | No subtasks section | "Subtasks" section shows child list | Only rendered when children exist |
| Subtask row click | N/A | `selectTask(subtask.id)` opens that task's drawer | Re-uses existing drawer |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/services/taskService.ts` | 40-390 | DB schema, migrations, row types, CRUD — must mirror exactly |
| P0 | `core/src/types/index.ts` | 30-50 | `Task` interface to extend |
| P0 | `core/src/agents/taskBreakdownRunner.ts` | 220-244 | Where `createTask` calls happen — add `parentTaskId` here |
| P0 | `gui/src/types/index.ts` | 23-44 | Frontend `Task` interface to extend |
| P1 | `gui/src/components/Card/TaskDetailDrawer.tsx` | 434-600+ | Details-tab rendering, `Section` component usage, `selectTask` hook |
| P1 | `gui/src/store/boardStore.ts` | 1-100 | `tasks: Record<string,Task>` — subtasks already in store; filter by `parentTaskId` |
| P2 | `core/src/routes/tasks.ts` | 47-84 | `createTaskSchema` / `updateTaskSchema` — add `parentTaskId` |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: core/src/types/index.ts:48-49
graphId?: string | null;
parentTaskId?: string | null;   // follow same optional-nullable pattern
```

### DB_MIGRATION
```typescript
// SOURCE: core/src/services/taskService.ts:341-351
{
  const taskColNames = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map(c => c.name);
  if (!taskColNames.includes('executionMode')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN executionMode TEXT NOT NULL DEFAULT 'simple'`);
  }
  if (!taskColNames.includes('graphId')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN graphId TEXT`);
  }
}
```

### ROW_TYPE
```typescript
// SOURCE: core/src/services/taskService.ts:407-435
interface TaskRow {
  // ...
  executionMode: string | null;
  graphId: string | null;
  // add:
  parentTaskId: string | null;
}
```

### ROW_TO_TASK_CONVERTER
```typescript
// SOURCE: core/src/services/taskService.ts:475-511
function rowToTask(row: TaskRow): Task {
  return {
    // ...
    graphId: row.graphId ?? null,
    parentTaskId: row.parentTaskId ?? null,  // follow same pattern
  };
}
```

### INSERT_STATEMENT
```typescript
// SOURCE: core/src/services/taskService.ts:526-538
const stmtInsertTask = db.prepare(
  `INSERT INTO tasks (
    ..., executionMode, graphId
  ) VALUES (
    ..., @executionMode, @graphId
  )`,
);
// Add parentTaskId to both column list and values list
```

### UPDATE_STATEMENTS
```typescript
// SOURCE: core/src/services/taskService.ts:550-597
// stmtUpdateTaskWithLog and stmtUpdateTaskWithoutLog
// Both must include parentTaskId = @parentTaskId
```

### TASK_PATCH_TYPE
```typescript
// SOURCE: core/src/services/taskService.ts:883-900
export type TaskPatch = Partial<
  Pick<Task, "...", "executionMode" | "graphId"> // add "parentTaskId"
> & { agent?: Partial<AgentState> };
```

### CREATE_TASK_INPUT
```typescript
// SOURCE: core/src/services/taskService.ts:797-807
export interface CreateTaskInput {
  // ...
  executionMode?: "simple" | "graph";
  graphId?: string | null;
  parentTaskId?: string | null;  // add
}
```

### ZOD_SCHEMA
```typescript
// SOURCE: core/src/routes/tasks.ts:47-84
const createTaskSchema = z.object({
  // ...
  parentTaskId: z.string().nullable().optional(),
});
const updateTaskSchema = z.object({
  // ...
  parentTaskId: z.string().nullable().optional(),
});
```

### DRAWER_SECTION
```tsx
// SOURCE: gui/src/components/Card/TaskDetailDrawer.tsx:443
<Section label={td.descriptionLabel} numeral="01">
  {/* content */}
</Section>
// Follow exact same pattern for the new Subtasks section
```

### STORE_SELECT
```tsx
// SOURCE: gui/src/components/Card/TaskDetailDrawer.tsx:278-281
const toolCalls = useBoardStore((s) => task ? (s.toolCalls[task.id] ?? EMPTY_TOOL_CALLS) : EMPTY_TOOL_CALLS);
// Derive subtasks from store similarly:
const subtasks = useBoardStore((s) =>
  task ? Object.values(s.tasks).filter(t => t.parentTaskId === task.id) : []
);
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/types/index.ts` | UPDATE | Add `parentTaskId?: string \| null` to `Task` |
| `core/src/services/taskService.ts` | UPDATE | Migration, row type, converter, insert/update stmts, `CreateTaskInput`, `TaskPatch` |
| `core/src/agents/taskBreakdownRunner.ts` | UPDATE | Pass `parentTaskId: task.id` to `createTask` |
| `core/src/routes/tasks.ts` | UPDATE | Add `parentTaskId` to `createTaskSchema` + `updateTaskSchema` |
| `gui/src/types/index.ts` | UPDATE | Add `parentTaskId?: string \| null` to `Task` |
| `gui/src/types/index.ts` (TaskPatch) | UPDATE | Add `parentTaskId` to `TaskPatch` pick list |
| `gui/src/components/Card/TaskDetailDrawer.tsx` | UPDATE | Add "Subtasks" section in details tab |

## NOT Building
- No new API endpoint for listing subtasks (frontend filters `boardStore.tasks` by `parentTaskId`)
- No "parent task" back-link shown in subtask drawer (out of scope)
- No cascading delete behaviour when parent deleted (existing cascade handles comment/tool-calls; task deletion already cascades)
- No drag-and-drop between parent and child
- No subtask creation from the drawer (only from breakdown runner)

---

## Step-by-Step Tasks

### Task 1: DB migration + core types
- **ACTION**: Add `parentTaskId TEXT REFERENCES tasks(id)` column to `tasks` table
- **IMPLEMENT**:
  - In `core/src/services/taskService.ts`, inside the existing migration block for `executionMode`/`graphId` (lines 342-351), add:
    ```typescript
    if (!taskColNames.includes('parentTaskId')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN parentTaskId TEXT REFERENCES tasks(id)`);
    }
    ```
  - Add `parentTaskId: string | null` to `TaskRow` interface (after `graphId`)
  - Add `parentTaskId: row.parentTaskId ?? null` to `rowToTask` return value (after `graphId`)
  - Add `parentTaskId TEXT` to `stmtInsertTask` column list and `@parentTaskId` to values list
  - Add `parentTaskId = @parentTaskId` to `stmtUpdateTaskWithLog` and `stmtUpdateTaskWithoutLog`
  - Add `parentTaskId?: string | null` to `CreateTaskInput` interface
  - Add `"parentTaskId"` to `TaskPatch` Pick list
  - In `createTask`: pass `parentTaskId: input.parentTaskId ?? null` to `stmtInsertTask.run`
  - In `updateTask`: include `parentTaskId: next.parentTaskId ?? null` in `params`
- **MIRROR**: `DB_MIGRATION`, `ROW_TYPE`, `ROW_TO_TASK_CONVERTER`, `INSERT_STATEMENT`, `UPDATE_STATEMENTS`, `CREATE_TASK_INPUT`, `TASK_PATCH_TYPE`
- **IMPORTS**: none new
- **GOTCHA**: `stmtInsertTask` is a prepared statement defined once at module load; adding a column to it means the text in the `db.prepare(...)` call must include `parentTaskId` in both the column list AND the `VALUES` list — they must stay in sync. Also update `createTask` to pass `parentTaskId: input.parentTaskId ?? null` in the `stmtInsertTask.run({...})` call.
- **VALIDATE**: `cd core && npm run typecheck` — zero errors

### Task 2: Core shared types
- **ACTION**: Add `parentTaskId` to `Task` in `core/src/types/index.ts`
- **IMPLEMENT**:
  ```typescript
  // After graphId?: string | null; (line 49)
  parentTaskId?: string | null;
  ```
- **MIRROR**: `NAMING_CONVENTION`
- **IMPORTS**: none
- **GOTCHA**: none
- **VALIDATE**: `cd core && npm run typecheck`

### Task 3: Route schema
- **ACTION**: Accept `parentTaskId` in create and update endpoints
- **IMPLEMENT**: In `core/src/routes/tasks.ts`:
  - `createTaskSchema`: add `parentTaskId: z.string().nullable().optional()`
  - `updateTaskSchema`: add `parentTaskId: z.string().nullable().optional()`
- **MIRROR**: `ZOD_SCHEMA`
- **IMPORTS**: none new
- **GOTCHA**: none
- **VALIDATE**: `cd core && npm run typecheck`

### Task 4: Task breakdown runner
- **ACTION**: Pass `parentTaskId` when creating subtasks
- **IMPLEMENT**: In `core/src/agents/taskBreakdownRunner.ts`, inside the `for (const item of items)` loop (line 222), change `createTask({...})` to include `parentTaskId: task.id`:
  ```typescript
  const created = await createTask({
    projectId: task.projectId,
    title: item.title,
    description: item.description,
    analysis: item.analysis,
    status: "todo",
    priority: item.priority,
    tags: item.tags,
    parentTaskId: task.id,   // ← add this
  });
  ```
- **MIRROR**: `CREATE_TASK_INPUT`
- **IMPORTS**: none new
- **GOTCHA**: `task` refers to the parent task fetched at the top of `runTaskBreakdown`
- **VALIDATE**: `cd core && npm run typecheck`

### Task 5: GUI types
- **ACTION**: Mirror type changes on the frontend
- **IMPLEMENT**:
  - In `gui/src/types/index.ts`, `Task` interface: add `parentTaskId?: string | null` after `graphId?: string | null` (line 43)
  - In `gui/src/types/index.ts`, `TaskPatch` Pick list: add `"parentTaskId"` alongside `"graphId"`
- **MIRROR**: `NAMING_CONVENTION`
- **IMPORTS**: none
- **GOTCHA**: `TaskPatch` in `gui/src/types/index.ts` is the frontend type (lines 73-89). The one in `core/src/services/taskService.ts` is the backend type — both need updating independently.
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 6: TaskDetailDrawer — Subtasks section
- **ACTION**: Render a "Subtasks" collapsible section in the details tab when subtasks exist
- **IMPLEMENT**:
  - After the existing imports at the top of `TaskDetailDrawer.tsx`, derive subtasks from the store:
    ```tsx
    const subtasks = useBoardStore((s) =>
      task ? Object.values(s.tasks).filter((t) => t.parentTaskId === task.id) : []
    );
    ```
  - In the details tab (`tab === "details"` block), add a `<Section>` between the Analysis section and the Breakdown section (numerals shift accordingly — or insert as 03 and renumber):
    ```tsx
    {subtasks.length > 0 && (
      <Section label="Subtasks" numeral="03">
        <ul className="space-y-1">
          {subtasks.map((sub) => (
            <li key={sub.id}>
              <button
                type="button"
                onClick={() => selectTask(sub.id)}
                className="flex w-full items-center gap-3 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-left text-sm transition hover:border-[var(--border-strong)]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: STATUS_COLOR[sub.status] }}
                />
                <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                  {sub.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
                  {sub.displayId ?? sub.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    )}
    ```
  - No new state needed — `subtasks` is derived from the store which already receives all `task_created` WS events
- **MIRROR**: `DRAWER_SECTION`, `STORE_SELECT`
- **IMPORTS**: none new (`STATUS_COLOR` and `selectTask` already imported/used in this file)
- **GOTCHA**: `useBoardStore` selector with `Object.values` runs on every store update — keep it outside render callbacks (already handled by placing it as a hook at component top level). Do NOT call hooks inside conditionals.
- **VALIDATE**: `cd gui && pnpm typecheck && pnpm lint`

---

## Testing Strategy

### Unit Tests
No existing tests for `TaskDetailDrawer` or `taskBreakdownRunner` in the test suite — do not add tests (per `core/CLAUDE.md`: "Do not add tests if there are none").

### Edge Cases Checklist
- [x] Task with no subtasks: section not rendered (guarded by `subtasks.length > 0`)
- [x] Subtask whose parent is deleted: `parentTaskId` FK is nullable-ref, no cascade — subtask remains with a dangling reference; section simply won't render because the parent is gone
- [x] Subtask task drawer opened: shows no subtasks section (parentTaskId set, but no children of its own)
- [x] DB upgrade on existing data: idempotent migration — existing rows get `parentTaskId = NULL`

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

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: No new lint errors

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: Both build cleanly

### Manual Validation
- [ ] Start backend: `cd core && npm run dev`
- [ ] Start frontend: `cd gui && pnpm dev`
- [ ] Create a task, open its drawer, click "Break down task", submit
- [ ] After breakdown: the parent task is in `nothing`; open its drawer → "Subtasks" section appears with each child listed
- [ ] Click a subtask row → drawer switches to that subtask
- [ ] Subtask drawer has NO "Subtasks" section
- [ ] Create a task without breakdown → its drawer has NO "Subtasks" section

---

## Acceptance Criteria
- [ ] `parentTaskId` column exists in the `tasks` table
- [ ] `taskBreakdownRunner` sets `parentTaskId: task.id` on every created subtask
- [ ] `TaskDetailDrawer` details tab shows "Subtasks" section when `subtasks.length > 0`
- [ ] Each subtask row shows: status dot, title, displayId — click opens that task's drawer
- [ ] No type errors (`npm run typecheck` + `pnpm typecheck`)
- [ ] No lint errors (`pnpm lint`)
- [ ] DB migration is idempotent (existing rows get `NULL`, no crash)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prepared statement `stmtInsertTask` column/values count mismatch | Medium | Runtime crash on task creation | Carefully count columns — compiler won't catch SQL string errors |
| `stmtUpdateTaskWithLog` / `stmtUpdateTaskWithoutLog` missing new column | Medium | Silent data loss (parentTaskId reset to null on update) | Update both statements |
| `Object.values(s.tasks)` expensive on large boards | Low | Minor perf | Acceptable at typical scale |

## Notes
- The `gui/src/lib/api.ts` `CreateTaskInput` has `parentTaskId` implicitly supported via the generic `PATCH /tasks/:id` body — no `api.ts` change needed since `parentTaskId` travels through the existing `updateTask` path once it's in `TaskPatch`.
- `api.createTask` input: `gui/src/lib/api.ts:31-41` — add `parentTaskId?: string | null` to `CreateTaskInput` if any UI path ever calls it directly with a parent. For now only `taskBreakdownRunner` (server-side) sets it, so no frontend `api.ts` change is required for initial scope.
