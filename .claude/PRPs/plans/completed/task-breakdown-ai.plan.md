# Plan: Task Breakdown AI

## Summary
Add a "Break down" button to the TaskDetailDrawer that sends the task's description/analysis to Claude,
which splits it into 5–8 subtasks and creates them in the same project. Mirrors the existing
project-level planner but operates at the task level.

## User Story
As a developer, I want to click "Break down" on a large task and have Claude split it into smaller
subtasks automatically, so I can start executing them one by one without manual planning.

## Problem → Solution
No task-level decomposition exists today → "Break down" button in the task drawer fires a backend agent
that calls Claude, parses a JSON task array, and creates the subtasks via the existing `createTask` path.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 10

---

## UX Design

### Before
```
┌────────────────────────────────────┐
│  Task Detail Drawer                │
│  [Details] [Log] [Comments] [Flow] │
│                                    │
│  Title: Build payment module       │
│  Description: big feature block    │
│                                    │
│  [Retry] [Abort] [Delete]          │
└────────────────────────────────────┘
```

### After
```
┌────────────────────────────────────┐
│  Task Detail Drawer                │
│  [Details] [Log] [Comments] [Flow] │
│                                    │
│  Title: Build payment module       │
│  Description: big feature block    │
│                                    │
│  ── Break Down Task ──────────────  │
│  [textarea – pre-filled desc+anal] │
│  [Generate 6 subtasks ▶] [Cancel]  │
│                                    │
│  [Retry] [Abort] [Delete]          │
└────────────────────────────────────┘
(while running → spinner; on done → panel collapses, tasks appear in board)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Details tab | No breakdown UI | "Break down task" expandable section | collapsed by default |
| Board | Tasks appear only via manual create | Subtasks appear via WS `task_created` events | automatic |
| Task drawer header | No status indicator | Spinner while breakdown runs | driven by boardStore |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/agents/projectPlanner.ts` | all | All parsing utils + Claude invocation pattern to mirror exactly |
| P0 | `core/src/types/index.ts` | 120–165 | `WsMessage` union — must add 3 new variants |
| P0 | `core/src/services/wsService.ts` | 60–125 | Broadcast function pattern |
| P0 | `core/src/routes/tasks.ts` | 1–84, 236–280 | Zod schemas + route pattern + fire-and-forget pattern |
| P1 | `gui/src/store/boardStore.ts` | 1–116, 350–363 | State interface + `updateProjectPlanningStatus` pattern to mirror |
| P1 | `gui/src/hooks/useAgentSocket.ts` | 120–165 | `project_planning_*` handlers — mirror exactly |
| P1 | `gui/src/components/Card/TaskDetailDrawer.tsx` | 63–250 | State pattern + async handlers + all existing actions |
| P1 | `gui/src/lib/api.ts` | 115–122 | `createTask` pattern for `breakdownTask` |
| P2 | `gui/src/lib/i18n/en.ts` | 268–336 | `taskDetail` keys structure |
| P2 | `gui/src/lib/i18n/tr.ts` | 268–340 | Turkish equivalents |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: core/src/agents/projectPlanner.ts:1-10
// Files: camelCase; exported functions: camelCase verbs; agent files: *Runner.ts or *Planner.ts
export async function runTaskBreakdown(
  taskId: string,
  prompt: string,
  maxTasks: number = 6,
): Promise<void>
```

### ERROR_HANDLING
```typescript
// SOURCE: core/src/agents/projectPlanner.ts:170-193
try {
  // ...work...
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[taskBreakdown] task ${taskId} failed:`, message);
  try {
    broadcastTaskBreakdownError(taskId, message);
  } catch (updateErr) {
    console.error(`[taskBreakdown] failed to broadcast error:`, updateErr);
  }
}
```

### BROADCAST_PATTERN
```typescript
// SOURCE: core/src/services/wsService.ts:106-121
export function broadcastTaskBreakdownStarted(taskId: string): void {
  broadcast({ type: "task_breakdown_started", taskId });
}
export function broadcastTaskBreakdownDone(taskId: string, taskCount: number): void {
  broadcast({ type: "task_breakdown_done", taskId, taskCount });
}
export function broadcastTaskBreakdownError(taskId: string, error: string): void {
  broadcast({ type: "task_breakdown_error", taskId, error });
}
```

### FIRE_AND_FORGET_ROUTE
```typescript
// SOURCE: core/src/routes/tasks.ts:236-280 (retry route)
router.post("/:id/breakdown", async (req: Request, res: Response) => {
  // validate → 404 if not found → fire-and-forget → 202
  runTaskBreakdown(task.id, prompt, maxTasks).catch((err) =>
    console.error("[tasks] breakdown failed:", err),
  );
  res.json({ status: "started" });
});
```

### STORE_STATUS_PATTERN
```typescript
// SOURCE: gui/src/store/boardStore.ts:355-362 (updateProjectPlanningStatus)
// Separate transient state map in boardStore, keyed by taskId
breakdownStatus: Record<string, "breaking" | "done" | "error">;
setBreakdownStatus: (taskId: string, status: "breaking" | "done" | "error") => void;
```

### WS_HANDLER_PATTERN
```typescript
// SOURCE: gui/src/hooks/useAgentSocket.ts:131-145
case "task_breakdown_started": {
  const m = msg as Extract<WsMessage, { type: "task_breakdown_started" }>;
  setBreakdownStatus(m.taskId, "breaking");
  break;
}
```

### API_CALL_PATTERN
```typescript
// SOURCE: gui/src/lib/api.ts:115-122
breakdownTask: (id: string, prompt: string, maxTasks?: number): Promise<{ status: string }> =>
  fetch(`${BASE}/tasks/${id}/breakdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTasks }),
  }).then((r) => handle<{ status: string }>(r)),
```

### DRAWER_ASYNC_HANDLER
```typescript
// SOURCE: gui/src/components/Card/TaskDetailDrawer.tsx:201-214 (doRetry pattern)
const doBreakdown = async () => {
  if (!task || !breakdownPrompt.trim()) return;
  setBreakdownError(null);
  try {
    await api.breakdownTask(task.id, breakdownPrompt.trim(), 6);
  } catch (err) {
    setBreakdownError(err instanceof Error ? err.message : "Breakdown failed");
  }
};
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/agents/taskBreakdownRunner.ts` | CREATE | New agent; mirrors projectPlanner.ts |
| `core/src/types/index.ts` | UPDATE | Add 3 `WsMessage` variants |
| `core/src/services/wsService.ts` | UPDATE | Add 3 broadcast functions |
| `core/src/routes/tasks.ts` | UPDATE | Add `POST /:id/breakdown` endpoint |
| `gui/src/types/index.ts` | UPDATE | Add 3 `WsMessage` variants (must stay in sync with core) |
| `gui/src/store/boardStore.ts` | UPDATE | Add `breakdownStatus` map + `setBreakdownStatus` action |
| `gui/src/hooks/useAgentSocket.ts` | UPDATE | Handle 3 new WS event types |
| `gui/src/lib/api.ts` | UPDATE | Add `breakdownTask` function |
| `gui/src/components/Card/TaskDetailDrawer.tsx` | UPDATE | Add breakdown UI section |
| `gui/src/lib/i18n/en.ts` | UPDATE | Add breakdown i18n keys to `taskDetail` |
| `gui/src/lib/i18n/tr.ts` | UPDATE | Add Turkish equivalents |

## NOT Building
- Nested subtask hierarchy (subtasks are flat tasks in the same project)
- Breakdown status persisted in DB (transient UI state only)
- Breakdown of tasks already in `doing`/`review` states (button disabled unless `todo`)
- Max-tasks config in UI (hardcoded 6, matches current project planner default-ish)

---

## Step-by-Step Tasks

### Task 1: Add WS message types to core types
- **ACTION**: Add 3 new union variants to `WsMessage` in `core/src/types/index.ts`
- **IMPLEMENT**:
  ```typescript
  | { type: "task_breakdown_started"; taskId: string }
  | { type: "task_breakdown_done"; taskId: string; taskCount: number }
  | { type: "task_breakdown_error"; taskId: string; error: string }
  ```
  Add after the `project_planning_error` variant (around line 163).
- **MIRROR**: Existing `project_planning_*` shape — same field names
- **IMPORTS**: none
- **GOTCHA**: `taskId` not `projectId` — don't confuse the field names
- **VALIDATE**: `cd core && npm run typecheck` — zero errors

### Task 2: Add broadcast functions to wsService
- **ACTION**: Add 3 export functions to `core/src/services/wsService.ts`
- **IMPLEMENT**:
  ```typescript
  export function broadcastTaskBreakdownStarted(taskId: string): void {
    broadcast({ type: "task_breakdown_started", taskId });
  }
  export function broadcastTaskBreakdownDone(taskId: string, taskCount: number): void {
    broadcast({ type: "task_breakdown_done", taskId, taskCount });
  }
  export function broadcastTaskBreakdownError(taskId: string, error: string): void {
    broadcast({ type: "task_breakdown_error", taskId, error });
  }
  ```
  Add after `broadcastProjectPlanningError` (line ~121).
- **MIRROR**: `broadcastProjectPlanningStarted` / `Done` / `Error` pattern exactly
- **IMPORTS**: none (uses existing `broadcast` local function)
- **GOTCHA**: none
- **VALIDATE**: `cd core && npm run typecheck`

### Task 3: Create taskBreakdownRunner.ts
- **ACTION**: Create `core/src/agents/taskBreakdownRunner.ts`
- **IMPLEMENT**: Copy the 6 pure parsing functions from `projectPlanner.ts` verbatim
  (`unwrapEnvelope`, `recoverArrayObjects`, `extractJsonArray`, `normalizePriority`,
  `normalizeTags`, `normalizeTasks`). Then write `runTaskBreakdown`:
  ```typescript
  export async function runTaskBreakdown(
    taskId: string,
    prompt: string,
    maxTasks: number = 6,
  ): Promise<void> {
    const cap = Math.max(1, Math.min(Math.floor(maxTasks) || 6, 20));
    try {
      broadcastTaskBreakdownStarted(taskId);
      const task = await getTask(taskId);       // import from taskService
      const project = await getProject(task.projectId);
      const cwd = project.repoPath && fs.existsSync(project.repoPath)
        ? project.repoPath
        : process.cwd();

      const systemPrompt =
        `You are a task planner. Break the following task description into at most ${cap} ` +
        `small, actionable subtasks.\n\nTask:\n${prompt}\n\n` +
        // ... same JSON schema instructions as projectPlanner ...
        `Return ONLY a JSON array, no other text. Each item: ` +
        `{ title, description, analysis, priority, tags }`;

      const result = await runClaude({
        prompt: systemPrompt,
        cwd,
        outputFormat: "json",
        maxOutputTokens: 16000,
      });

      if (result.code !== 0) {
        throw new Error(`claude CLI exited ${result.code}: ${result.stderr.slice(0, 500)}`);
      }

      const parsed = extractJsonArray(result.stdout);
      const items  = normalizeTasks(parsed, cap);

      for (const item of items) {
        const created = await createTask({
          projectId: task.projectId,
          title:       item.title,
          description: item.description,
          analysis:    item.analysis,
          status:      "todo",
          priority:    item.priority,
          tags:        item.tags,
        });
        broadcastTaskCreated(created);
        await new Promise((r) => setTimeout(r, 200));
      }

      broadcastTaskBreakdownDone(taskId, items.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[taskBreakdown] task ${taskId} failed:`, message);
      broadcastTaskBreakdownError(taskId, message);
    }
  }
  ```
- **MIRROR**: `runProjectPlanner` structure — same try/catch, same delay between creates
- **IMPORTS**:
  ```typescript
  import fs from "node:fs";
  import { runClaude } from "../services/claudeService.js";
  import { getTask, getProject, createTask } from "../services/taskService.js";
  import type { TaskPriority } from "../types/index.js";
  import {
    broadcastTaskCreated,
    broadcastTaskBreakdownStarted,
    broadcastTaskBreakdownDone,
    broadcastTaskBreakdownError,
  } from "../services/wsService.js";
  ```
- **GOTCHA**: Use `getTask` and `getProject` to find the `projectId` — don't hardcode cwd
- **VALIDATE**: `cd core && npm run typecheck`

### Task 4: Add POST /:id/breakdown route to tasks.ts
- **ACTION**: Add new route to `core/src/routes/tasks.ts`
- **IMPLEMENT**:
  ```typescript
  const breakdownSchema = z.object({
    prompt:   z.string().min(1).max(6000),
    maxTasks: z.number().int().min(1).max(20).optional(),
  });

  router.post("/:id/breakdown", async (req: Request, res: Response) => {
    const task = await getTask(req.params.id).catch(() => null);
    if (!task) return res.status(404).json({ error: "task_not_found" });

    const parsed = breakdownSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    }

    runTaskBreakdown(task.id, parsed.data.prompt, parsed.data.maxTasks ?? 6)
      .catch((err) => console.error("[tasks] breakdown failed:", err));

    res.json({ status: "started" });
  });
  ```
  Add import at the top:
  ```typescript
  import { runTaskBreakdown } from "../agents/taskBreakdownRunner.js";
  ```
  Place route before `router.delete("/:id", ...)`.
- **MIRROR**: `router.post("/:id/retry", ...)` fire-and-forget shape
- **IMPORTS**: `runTaskBreakdown` from `../agents/taskBreakdownRunner.js`
- **GOTCHA**: `max(6000)` on prompt per defensive-defaults rule in CLAUDE.md
- **VALIDATE**: `cd core && npm run typecheck`

### Task 5: Add WS types to gui types + boardStore
- **ACTION**: Update `gui/src/types/index.ts` + `gui/src/store/boardStore.ts`
- **IMPLEMENT** (types — add same 3 variants as core, keeping gui/core in sync):
  ```typescript
  | { type: "task_breakdown_started"; taskId: string }
  | { type: "task_breakdown_done"; taskId: string; taskCount: number }
  | { type: "task_breakdown_error"; taskId: string; error: string }
  ```
  **boardStore interface** — add to `BoardState`:
  ```typescript
  breakdownStatus: Record<string, "breaking" | "done" | "error">;
  setBreakdownStatus: (taskId: string, status: "breaking" | "done" | "error") => void;
  ```
  **boardStore implementation** — add initial value + action:
  ```typescript
  breakdownStatus: {},
  setBreakdownStatus: (taskId, status) =>
    set((state) => ({
      breakdownStatus: { ...state.breakdownStatus, [taskId]: status },
    })),
  ```
- **MIRROR**: `ciIterations` pattern for the map; `updateProjectPlanningStatus` for the action
- **IMPORTS**: none new
- **GOTCHA**: `breakdownStatus` is transient — never needs persistence or reset on task change
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 6: Handle WS events in useAgentSocket
- **ACTION**: Add 3 `case` blocks to the WS switch in `gui/src/hooks/useAgentSocket.ts`
- **IMPLEMENT**: After the `project_planning_error` case block (~line 145), add:
  ```typescript
  case "task_breakdown_started": {
    const m = msg as Extract<WsMessage, { type: "task_breakdown_started" }>;
    setBreakdownStatus(m.taskId, "breaking");
    break;
  }
  case "task_breakdown_done": {
    const m = msg as Extract<WsMessage, { type: "task_breakdown_done" }>;
    setBreakdownStatus(m.taskId, "done");
    break;
  }
  case "task_breakdown_error": {
    const m = msg as Extract<WsMessage, { type: "task_breakdown_error" }>;
    setBreakdownStatus(m.taskId, "error");
    break;
  }
  ```
  Destructure `setBreakdownStatus` from `useBoardStore` at the top of the hook (same block as the other actions).
- **MIRROR**: `project_planning_*` case blocks exactly
- **IMPORTS**: `setBreakdownStatus` via `useBoardStore((s) => s.setBreakdownStatus)`
- **GOTCHA**: `task_created` WS events still handled separately — subtasks auto-appear via the existing handler
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 7: Add breakdownTask to api.ts
- **ACTION**: Add one function to the `api` object in `gui/src/lib/api.ts`
- **IMPLEMENT**:
  ```typescript
  breakdownTask: (id: string, prompt: string, maxTasks?: number): Promise<{ status: string }> =>
    fetch(`${BASE}/tasks/${id}/breakdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxTasks }),
    }).then((r) => handle<{ status: string }>(r)),
  ```
- **MIRROR**: `retryTask` / `abortTask` pattern
- **IMPORTS**: none
- **GOTCHA**: none
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 8: Add i18n keys
- **ACTION**: Add breakdown keys to `taskDetail` in `gui/src/lib/i18n/en.ts` AND `tr.ts`
- **IMPLEMENT** (add inside `taskDetail: { ... }` object):
  ```typescript
  // en.ts
  breakdownLabel: "Break down task",
  breakdownPromptPlaceholder: "Describe what to break down...",
  breakdownButton: "Generate subtasks",
  breakdowning: "Generating...",
  breakdownDone: "Subtasks created",
  breakdownError: "Breakdown failed",
  breakdownCancel: "Cancel",

  // tr.ts
  breakdownLabel: "Görevi parçala",
  breakdownPromptPlaceholder: "Neye parçalanacağını açıkla...",
  breakdownButton: "Alt görevler oluştur",
  breakdowning: "Oluşturuluyor...",
  breakdownDone: "Alt görevler oluşturuldu",
  breakdownError: "Parçalama başarısız",
  breakdownCancel: "İptal",
  ```
- **MIRROR**: existing `taskDetail` key style — camelCase, short strings
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 9: Add breakdown UI to TaskDetailDrawer
- **ACTION**: Update `gui/src/components/Card/TaskDetailDrawer.tsx`
- **IMPLEMENT**:
  1. Read `breakdownStatus` from store: `const breakdownStatus = useBoardStore((s) => task ? s.breakdownStatus[task.id] : undefined);`
  2. Add local state: `const [showBreakdown, setShowBreakdown] = useState(false);` and `const [breakdownPrompt, setBreakdownPrompt] = useState("");` and `const [breakdownError, setBreakdownError] = useState<string | null>(null);`
  3. Add handler:
     ```typescript
     const doBreakdown = async () => {
       if (!task || !breakdownPrompt.trim()) return;
       setBreakdownError(null);
       try {
         await api.breakdownTask(task.id, breakdownPrompt.trim(), 6);
       } catch (err) {
         setBreakdownError(err instanceof Error ? err.message : td.breakdownError);
       }
     };
     ```
  4. When `showBreakdown` is opened, pre-fill prompt: `setBreakdownPrompt([task.title, task.description, task.analysis].filter(Boolean).join("\n\n"));`
  5. In the details tab JSX (after the analysis section, before action buttons), add:
     ```tsx
     {!editing && (
       <div className="mt-4">
         {!showBreakdown ? (
           <button
             type="button"
             onClick={() => { setShowBreakdown(true); setBreakdownPrompt([task.title, task.description, task.analysis].filter(Boolean).join("\n\n")); }}
             className="text-[12px] text-[var(--accent-primary)] border border-[var(--border)] px-3 py-1.5 hover:border-[var(--accent-primary)] transition"
           >
             {td.breakdownLabel}
           </button>
         ) : (
           <div className="flex flex-col gap-2 border border-[var(--border)] p-3">
             <textarea
               value={breakdownPrompt}
               onChange={(e) => setBreakdownPrompt(e.target.value)}
               rows={5}
               disabled={breakdownStatus === "breaking"}
               placeholder={td.breakdownPromptPlaceholder}
               className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none"
             />
             {breakdownError && (
               <p className="text-[11px] text-[var(--status-error)]">{breakdownError}</p>
             )}
             {breakdownStatus === "done" && (
               <p className="text-[11px] text-[var(--accent-primary)]">{td.breakdownDone}</p>
             )}
             <div className="flex gap-2">
               <button
                 type="button"
                 onClick={doBreakdown}
                 disabled={breakdownStatus === "breaking" || !breakdownPrompt.trim()}
                 className="btn-ink px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
               >
                 {breakdownStatus === "breaking" ? td.breakdowning : td.breakdownButton}
               </button>
               <button
                 type="button"
                 onClick={() => { setShowBreakdown(false); setBreakdownError(null); }}
                 className="btn-ghost px-3 py-1.5 text-[12px]"
               >
                 {td.breakdownCancel}
               </button>
             </div>
           </div>
         )}
       </div>
     )}
     ```
- **MIRROR**: `saveEdit` async pattern for `doBreakdown`; `btn-ink` / `btn-ghost` class names from existing buttons; `inputCls` style for textarea
- **IMPORTS**: none new (api already imported)
- **GOTCHA**: Do not reset `breakdownStatus` manually — it's driven by WS events. `breakdownStatus === "breaking"` disables inputs. The panel stays open after `done` so user can see the confirmation message.
- **VALIDATE**: `cd gui && pnpm typecheck && pnpm lint`

---

## Testing Strategy

### Unit Tests
No tests currently exist in the project — follow CLAUDE.md rule: only add tests when asked.

### Edge Cases Checklist
- [ ] Task with no description/analysis — textarea still pre-fills with just the title
- [ ] Claude returns malformed JSON — `extractJsonArray` recovery handles it; error broadcasts
- [ ] Claude CLI exits non-zero — error broadcasts, error message shown in drawer
- [ ] User triggers breakdown while `breakdownStatus === "breaking"` — button is disabled
- [ ] Multiple breakdowns on different tasks simultaneously — status keyed by taskId, no cross-contamination
- [ ] Network failure on `api.breakdownTask` POST — `breakdownError` shown in drawer

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
EXPECT: Zero lint errors

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: Both build successfully

### Manual Validation
- [ ] Open a task in the drawer → see "Break down task" button in details tab
- [ ] Click it → textarea expands, pre-filled with task title + description + analysis
- [ ] Click "Generate subtasks" → button shows "Generating..."
- [ ] Backend creates tasks → they appear in the board's "Todo" column
- [ ] Panel shows "Subtasks created" message
- [ ] Click "Cancel" → panel collapses without error
- [ ] Test with no description — textarea pre-fills with title only
- [ ] Simulate backend error (disconnect server) → error message appears in panel

---

## Acceptance Criteria
- [ ] "Break down task" button visible in details tab when not editing
- [ ] Clicking button expands panel with pre-filled textarea
- [ ] POST fires to `/api/tasks/:id/breakdown`
- [ ] Backend creates 1–6 subtasks in the same project
- [ ] New tasks appear in board via WS without page reload
- [ ] Loading state shown while breakdown runs
- [ ] Error displayed inline if breakdown fails
- [ ] `pnpm typecheck`, `npm run typecheck`, and `pnpm lint` all pass

## Completion Checklist
- [ ] Code follows discovered patterns (fire-and-forget, WS broadcast, store action)
- [ ] Error handling matches codebase style (try/catch + console.error + broadcast)
- [ ] Logging follows codebase conventions (`[taskBreakdown] task ${taskId}`)
- [ ] No hardcoded strings — all UI text via i18n keys
- [ ] Both `en.ts` and `tr.ts` updated
- [ ] `core` and `gui` `WsMessage` types stay in sync (same 3 variants)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude response not JSON array | Medium | Agent fails silently | `extractJsonArray` recovery handles it; error broadcasts to drawer |
| `getTask` / `getProject` not exported from taskService | Low | Compile error | Both already exported (used by other routes) |
| gui/core WsMessage type drift | Low | Type error at build | Both updated in same PR, typecheck catches it |

## Notes
- `taskBreakdownRunner.ts` duplicates the 6 parsing functions from `projectPlanner.ts` by design.
  They're pure functions with no side effects — duplication avoids coupling agents to each other.
  If a third agent needs them later, extract to a shared util at that point.
- No delay needed before showing the "Break down task" button — it's always available in `todo` tasks.
  Consider disabling it for `doing`/`review` if desired (not in scope now).
- The `200ms` delay between `createTask` calls (same as projectPlanner) throttles rapid DB writes.
