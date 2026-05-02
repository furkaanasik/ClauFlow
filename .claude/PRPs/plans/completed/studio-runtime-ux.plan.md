# Plan: Phase 3 — Studio Runtime UX

## Summary

Make graph runs **observable and recoverable** from the Studio canvas. Three pillars:

1. **Run-trace overlay** — listen to existing `node_started` / `node_finished` / `node_log` WS events (already broadcast unconditionally by `wsService.ts:148-174` since Phase 2) and visually highlight the active node on `StudioCanvas.tsx`. Per-node status colors (idle/running/done/error/aborted) plus an inline log/text panel scoped to the selected node.
2. **Per-node abort/retry** — `POST /api/tasks/:taskId/nodes/:nodeId/abort` and `.../retry`. Abort cancels just the in-flight node by sharing the existing per-task `AbortController` (`executor.ts:57`); retry resumes the linear chain from the failed/aborted node forward, carrying `outputArtifact` from the prior `task_node_runs` row (`taskService.ts:1502 listNodeRunsByTask`).
3. **Save-time graph validation** — when `PUT /api/projects/:id/claude/graph` is called, run `planGraph()` (`graphRunner.ts:73`) before writing to disk and surface the `GraphValidationReason` (`no_nodes` | `no_entry` | `multiple_entries` | `cycle` | `branching` | `disconnected`) with a 400 `validation_error` envelope. The Studio save button blocks on the response and renders inline diagnostics next to offending nodes.

No new orchestration semantics: linear chains only (cycles still rejected — Phase 4 will introduce CI fix-loop cycles separately). No new kanban columns.

## User Story

As a **ClauFlow user authoring multi-node graphs in the Studio**, I want to **watch a run light up on the canvas, abort a stuck node and retry it without restarting the task, and catch invalid topologies before saving**, so that **graph authoring stops being a guessing game and a single bad node doesn't cost me the whole task's progress.**

## Problem → Solution

**Current state (post-Phase 2)**:
- `graphRunner.ts` walks linear chains and emits `node_started/finished/log` WS events tagged with the `NodeRun` row.
- `StudioCanvas.tsx` is purely an authoring surface — agnostic of `taskId`, no live status. Users must read the `TaskDetailDrawer` log to know which node is running.
- `POST /api/tasks/:id/abort` (`tasks.ts:243`) kills the whole task; `POST /api/tasks/:id/retry` (`tasks.ts:205`) resets and re-enqueues from scratch — so a 3-node graph that fails on `reviewer` re-runs `planner` and `coder` too, wasting tokens.
- Saving an invalid graph (cycle, two entries) succeeds silently; the next `doing` drag fails with a runtime `GraphValidationError`.

**Desired state**:
- Studio canvas, when bound to a `taskId` (new query param `?taskId=...`), subscribes to that task's node events and applies a status class per `AgentNode`.
- Abort/retry are per-node. Retry skips successfully-completed prior nodes by reading their `outputArtifact` and seeding `prior` artifact in `runGraph`.
- Save UX reuses `planGraph` server-side and renders error chips inline before the file is written.

## Metadata
- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/orchestration-ci-observability.prd.md](../prds/orchestration-ci-observability.prd.md)
- **PRD Phase**: Phase 3 — Studio Runtime UX
- **Estimated Files**: ~10 (4 new, 6 edits)
- **Estimated LOC**: 500–650

---

## UX Design

### Before
```
Studio (/board → "Studio" tab on a project)
  └─ StudioCanvas: drag agents, draw edges, [Save layout]
                   (no concept of a running task)

TaskDetailDrawer (board card → drawer)
  └─ flat agent_log stream (Phase 2: events have `nodeId` but UI ignores it)
  └─ [Abort task] [Retry task] (whole-task only)
```

### After
```
Studio (/board?projectId=…&taskId=<optional>)
  └─ StudioCanvas
       └─ AgentNode (per slug)
            ├─ status pill: idle | running | done | error | aborted
            ├─ ring color: var(--status-running|done|error|aborted)
            ├─ [Abort] visible while running
            ├─ [Retry] visible while error/aborted
            └─ click → opens NodeRunPanel (right pane)
                       └─ live log + tokens + model + timestamps
       └─ [Save layout]
            └─ on validation error: red border on offending nodes
                 + toast: "Graph invalid: cycle (planner-1 → coder-1 → planner-1)"

TaskDetailDrawer
  └─ existing log + new "Open in Studio" link → /board?taskId=<id>
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Studio canvas | Authoring only | Authoring + run-trace when `?taskId=` set | Backwards compatible — no taskId = same as today |
| Per-node abort | N/A | `POST /api/tasks/:id/nodes/:nodeId/abort` | Aborts only in-flight node; downstream nodes never start |
| Per-node retry | N/A | `POST /api/tasks/:id/nodes/:nodeId/retry` | Resumes from that node forward; reuses prior `outputArtifact` |
| Graph save | Always 200 | 400 with `{ error, reason, offendingNodeIds }` for invalid topologies | Reuses `planGraph` |
| WS events consumed by GUI | `node_started/finished/log` ignored | Routed into a new `nodeRuns` slice in `boardStore` | Additive |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | [core/src/agents/graphRunner.ts](../../../core/src/agents/graphRunner.ts) | 1–165 | `planGraph` (validation), `deriveNodeType`, `buildNodePrompt`, `runGraph` skeleton — the contract Phase 3 wraps. The plan extends `planGraph`'s error variant to expose offending node IDs. |
| P0 | [core/src/agents/graphRunner.ts](../../../core/src/agents/graphRunner.ts) | 170–415 | `runGraph` main loop — Task 5 introduces `runGraphFrom(startNodeId, seedArtifact)` for retry resumption |
| P0 | [core/src/agents/executor.ts](../../../core/src/agents/executor.ts) | 50–110 | `RUNNING` map + `abort` + `isRunning` + `waitForExecutorIdle` — per-node abort reuses these primitives, does NOT introduce a second map |
| P0 | [core/src/routes/tasks.ts](../../../core/src/routes/tasks.ts) | 205–275 | Existing whole-task abort/retry — Phase 3's per-node endpoints mirror this shape (404/400/409 envelopes, `broadcastTaskUpdated`) |
| P0 | [core/src/services/taskService.ts](../../../core/src/services/taskService.ts) | 1361–1505 | `insertNodeRun` / `updateNodeRun` / `getNodeRun` / `listNodeRunsByTask` — retry reads prior rows to seed artifact, validation status reads them too |
| P0 | [core/src/services/wsService.ts](../../../core/src/services/wsService.ts) | 148–174 | `broadcastNodeStarted/Finished/Log` — already wired in Phase 2; GUI consumes for the first time here |
| P0 | [core/src/routes/projectsClaude.ts](../../../core/src/routes/projectsClaude.ts) | 671–702 | Graph PUT route — Phase 3 inserts `planGraph()` validation before disk write |
| P0 | [gui/src/components/Studio/StudioCanvas.tsx](../../../gui/src/components/Studio/StudioCanvas.tsx) | 1–397 | Whole file — canvas owns nodes/edges state, save handler, AgentEditDrawer wiring. Phase 3 layers a `nodeRuns` map onto `AgentNodeData` and adds `taskId` prop. |
| P0 | [gui/src/components/Studio/AgentNode.tsx](../../../gui/src/components/Studio/AgentNode.tsx) | all | Per-node visual; gains status ring + abort/retry buttons |
| P0 | [gui/src/hooks/useAgentSocket.ts](../../../gui/src/hooks/useAgentSocket.ts) | 66–162 | The discriminated-union switch where new event types are routed |
| P0 | [gui/src/store/boardStore.ts](../../../gui/src/store/boardStore.ts) | all | Where `nodeRuns: Record<taskId, Record<nodeId, NodeRun>>` slice goes |
| P0 | [gui/src/lib/api.ts](../../../gui/src/lib/api.ts) | 280–310 | Add `abortNode`, `retryNode`, extend `putProjectGraph` error handling |
| P1 | [gui/src/types/index.ts](../../../gui/src/types/index.ts) | 100–210 | `NodeRun`, `WsMessage` union — already has `node_*` variants from Phase 2 |
| P1 | [core/src/types/index.ts](../../../core/src/types/index.ts) | 91–160 | Server mirror of NodeRun + WS union |
| P2 | [.claude/PRPs/plans/completed/graph-runner-mvp.plan.md](./completed/graph-runner-mvp.plan.md) | all | Phase 2 patterns (NodeRun lifecycle, abort handling, test self-cleaning) |

## External Documentation

None required. ReactFlow custom-node styling, WebSocket discriminated-union dispatch, and Express route patterns are all already established in the repo.

---

## Patterns to Mirror

### NODE_RUN_ALREADY_EMITTED (Phase 2)
```ts
// SOURCE: core/src/services/wsService.ts:148-174  (already wired, never gated)
export function broadcastNodeStarted(nodeRun: NodeRun): void {
  broadcast({ type: "node_started", taskId: nodeRun.taskId, payload: nodeRun });
}
export function broadcastNodeFinished(nodeRun: NodeRun): void {
  broadcast({ type: "node_finished", taskId: nodeRun.taskId, payload: nodeRun });
}
export function broadcastNodeLog(taskId: string, nodeId: string, line: string): void {
  broadcast({ type: "node_log", taskId, payload: { nodeId, line } });
}
```
Phase 3 does not change the wire format. The GUI just starts consuming what's already in flight.

### EXISTING_TASK_ABORT (mirror exactly for per-node)
```ts
// SOURCE: core/src/routes/tasks.ts:243-275
router.post("/:id/abort", async (req, res) => {
  const id = req.params.id!;
  const task = await getTask(id);
  if (!task) return res.status(404).json({ error: "not_found" });
  if (isExecutorRunning(id)) {
    abortExecutor(id);
    return res.json({ aborted: true, source: "in_memory" });
  }
  // ... orphan cleanup ...
});
```
Per-node abort uses the **same** `abortExecutor` (one AbortController per task — there is no per-node controller). The graph runner already checks `controller.signal.aborted` between nodes (`graphRunner.ts:182`), so aborting collapses the chain at the next boundary.

### EXISTING_TASK_RETRY (mirror for per-node, with resumption)
```ts
// SOURCE: core/src/routes/tasks.ts:205-241
router.post("/:id/retry", async (req, res) => {
  const task = await getTask(req.params.id!);
  if (task.status !== "doing") return res.status(400).json({ error: "task_not_in_doing" });
  if (isExecutorRunning(task.id)) {
    abortExecutor(task.id);
    await waitForExecutorIdle(task.id, 5000);
  }
  const reset = await updateTask(task.id, { agent: { status: "idle", log: [], ... } });
  broadcastTaskUpdated(reset);
  res.json({ task: reset });
  if (project) enqueueExecutor(reset, project);
});
```
Per-node retry differs: instead of clearing the whole task it inserts a `resumeFromNodeId` hint that `runGraph` reads and uses to skip already-`done` nodes (their `outputArtifact` becomes the `prior` seed). New helper `enqueueExecutorResume(task, project, { resumeFromNodeId })`.

### GRAPH_PUT_VALIDATION_INSERTION_POINT
```ts
// SOURCE: core/src/routes/projectsClaude.ts:671-702
router.put("/:id/claude/graph", async (req, res) => {
  const parsed = graphSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  // <-- NEW: planGraph() validation here, before fs writes -->
  // ...
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, file);
  // ...
});
```
Insert `planGraph(parsed.data)` between the zod check and the disk write. On `GraphValidationError`, return `400 { error: "graph_invalid", reason, offendingNodeIds }`. On success (and **only** on success) continue to disk + topology sync.

### WS_DISPATCH_ADDITION (boardStore wiring)
```ts
// SOURCE: gui/src/hooks/useAgentSocket.ts:81-100
case "agent_log": {
  const m = msg as Extract<WsMessage, { type: "agent_log" }>;
  appendLog(m.taskId, m.payload.line);
  break;
}
case "agent_status": { ... }
case "agent_tool_call": { ... }
case "agent_text": { ... }
```
Add three new arms: `node_started` → `upsertNodeRun(payload)`, `node_finished` → `upsertNodeRun(payload)`, `node_log` → `appendNodeLog(taskId, nodeId, line)`. Same destructuring + `Extract<WsMessage, ...>` pattern.

### REACTFLOW_CUSTOM_NODE_STYLING
```tsx
// SOURCE: gui/src/components/Studio/AgentNode.tsx (already a custom node)
//         gui/src/components/Studio/StudioCanvas.tsx:28
const NODE_TYPES: NodeTypes = { agent: AgentNode };
```
`AgentNodeData` gets a new optional `runState?: { status: NodeRunStatus; nodeRunId: string; tokens?: { input: number; output: number }; model?: string | null }`. `AgentNode.tsx` reads `data.runState` and switches a CSS class per status. Existing `data` shape is widened — no breaking change.

### NODE_RUN_LIFECYCLE_REUSE (server)
```ts
// SOURCE: core/src/agents/graphRunner.ts:198-216
const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;
const nodeRun = insertNodeRun({
  id: nodeRunId, taskId, nodeId, nodeType, status: "running",
  startedAt: new Date().toISOString(),
  inputArtifact: prior, model: agent.frontmatter.model ?? null,
});
broadcastNodeStarted(nodeRun);
```
Resume path reuses the same insert; the rows for skipped nodes are NOT re-created — they remain from the first attempt. Only the `resumeFromNodeId` and forward get fresh `task_node_runs` rows. The query `listNodeRunsByTask` orders by `startedAt`, so the timeline reads as: original done rows → new running row for the resumed node → new rows for downstream.

### TEST_PATTERN_SELF_CLEANING
```ts
// SOURCE: core/src/services/taskService.nodeRuns.test.ts
const SUFFIX = `phase3_${Date.now()}`;
let projectId = ""; let taskId = "";
beforeAll(async () => { /* create fixture project + task */ });
afterAll(() => { /* DELETE FROM tasks/projects WHERE id = ? */ });
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/agents/graphRunner.ts` | UPDATE | Extend `GraphValidationError` with `offendingNodeIds: string[]`; add `runGraphFrom(task, project, graph, controller, baseBranch, resumeFromNodeId)` that seeds `prior` from prior `task_node_runs` row and skips completed nodes |
| `core/src/agents/executor.ts` | UPDATE | Add `enqueueExecutorResume(task, project, { resumeFromNodeId })` that wraps `enqueue` and threads the hint through to `runGraph` (existing `RUNNING` map unchanged) |
| `core/src/routes/tasks.ts` | UPDATE | Add `POST /:id/nodes/:nodeId/abort` and `POST /:id/nodes/:nodeId/retry` |
| `core/src/routes/projectsClaude.ts` | UPDATE | Insert `planGraph()` validation in `PUT /claude/graph` handler before disk write |
| `core/src/agents/graphRunner.test.ts` | UPDATE | Cases for `offendingNodeIds`, resume-from-node logic |
| `gui/src/lib/api.ts` | UPDATE | `abortNode(taskId, nodeId)`, `retryNode(taskId, nodeId)`; widen `putProjectGraph` rejection type to surface `{ reason, offendingNodeIds }` |
| `gui/src/store/boardStore.ts` | UPDATE | Add `nodeRuns: Record<taskId, Record<nodeId, NodeRun>>` slice + `nodeLogs: Record<taskId, Record<nodeId, string[]>>`; `upsertNodeRun`, `appendNodeLog`, `clearNodeRuns(taskId)` |
| `gui/src/hooks/useAgentSocket.ts` | UPDATE | Three new dispatch arms: `node_started`, `node_finished`, `node_log` |
| `gui/src/components/Studio/StudioCanvas.tsx` | UPDATE | Accept optional `taskId` prop; subscribe to `nodeRuns[taskId]` from store; map status onto each `AgentNodeData.runState`; render inline validation chips on save error |
| `gui/src/components/Studio/AgentNode.tsx` | UPDATE | Status ring + per-node Abort/Retry buttons; click opens NodeRunPanel |
| `gui/src/components/Studio/NodeRunPanel.tsx` | CREATE | Right-side panel showing nodeRun details + live log for the selected node |
| `gui/src/app/board/page.tsx` | UPDATE (small) | Read `taskId` from search params and pass to Studio when Studio is mounted in run-trace mode (or wire through TaskDetailDrawer "Open in Studio" link) |

## NOT Building

- **Cyclic-graph support / CI fix loop** — Phase 4. `planGraph` keeps rejecting cycles; Phase 4 will introduce a separate cyclic node type.
- **Branching / parallel sub-paths** — out of scope; still rejected by `planGraph`.
- **Per-node USD budget / cost guard** — Phase 5.
- **`/insights` aggregation** — Phase 6.
- **Multi-task overlay on the same canvas** — only the currently-bound `taskId` shows live state.
- **Editing the graph during a live run** — Studio save is disabled while `task.agentStatus === "running"` for the bound task.
- **Cross-task abort cascade** — out of scope; comment-runner still operates on its own path.
- **Persisting per-node `agentLog` to DB** — node logs stay in-memory in the GUI store (matches existing `agent_log` behavior); `task_node_runs.outputArtifact.text` is the durable record.
- **GUI for `allowedTools` validation** — already shipped in Phase 2's AgentEditDrawer; no changes here.

---

## Step-by-Step Tasks

### Task 1: Extend `GraphValidationError` with `offendingNodeIds`
- **ACTION**: Edit `core/src/agents/graphRunner.ts`.
- **IMPLEMENT**:
  ```ts
  export class GraphValidationError extends Error {
    constructor(
      public reason: GraphValidationReason,
      public offendingNodeIds: string[] = [],
    ) {
      super(`Graph validation failed: ${reason}`);
      this.name = "GraphValidationError";
    }
  }
  ```
  Update each throw site in `planGraph`:
  - `no_entry` → pass all node IDs (none qualify as entry).
  - `multiple_entries` → pass `entries`.
  - `branching` → pass the source node IDs whose out-degree > 1.
  - `cycle` → pass the cycle path detected (the `cur` set when `seen.has(cur)` is true; track via the order array up to that point).
  - `disconnected` → pass node IDs not reached by the linear walk (`graph.nodes.filter(n => !seen.has(n.id)).map(n => n.id)`).
- **MIRROR**: existing throw shape at `graphRunner.ts:73-117`.
- **GOTCHA**: `cycle` detection must keep accumulating `cur` ids before the throw — do NOT throw inside the `while` until you have the offending id captured. Restructure to: detect repeat → push existing `cur` to a `cycleIds` array → throw.
- **VALIDATE**: `cd core && npm run typecheck`.

### Task 2: Add resume support to `runGraph`
- **ACTION**: Edit `core/src/agents/graphRunner.ts`.
- **IMPLEMENT**:
  ```ts
  export interface RunGraphOptions {
    resumeFromNodeId?: string;
  }

  export async function runGraph(
    task: Task, project: Project, graph: AgentGraph,
    controller: AbortController, baseBranch: string,
    options: RunGraphOptions = {},
  ): Promise<RunGraphResult> {
    const plan = planGraph(graph);
    const startIdx = options.resumeFromNodeId
      ? plan.order.indexOf(options.resumeFromNodeId)
      : 0;
    if (startIdx < 0) {
      throw new Error(`resumeFromNodeId '${options.resumeFromNodeId}' not in plan`);
    }

    let prior: NodeArtifact | null = null;
    if (startIdx > 0) {
      const priorNodeId = plan.order[startIdx - 1];
      const rows = listNodeRunsByTask(task.id);
      const lastDone = [...rows].reverse().find(
        (r) => r.nodeId === priorNodeId && r.status === "done",
      );
      if (!lastDone || !lastDone.outputArtifact) {
        throw new Error(
          `Cannot resume at '${options.resumeFromNodeId}': prior node '${priorNodeId}' has no done row`,
        );
      }
      prior = lastDone.outputArtifact as NodeArtifact;
    }

    for (let i = startIdx; i < plan.order.length; i++) {
      const nodeId = plan.order[i];
      // ... existing per-node body verbatim ...
    }
  }
  ```
- **MIRROR**: existing main loop at `graphRunner.ts:170-415`. Only the loop **start** changes; per-node body is verbatim.
- **GOTCHA**:
  1. `outputArtifact` is stored as JSON-stringified TEXT in SQLite (`taskService.ts:1361`); `listNodeRunsByTask` already returns it as a parsed object — no double parse.
  2. Existing `task_node_runs` rows for completed nodes stay; new rows for the resumed node forward are inserted with fresh `nodeRunId`s. The GUI sees both old `done` rows and new `running` rows for the same `nodeId` — `boardStore.upsertNodeRun` keys by `nodeId` (not `nodeRunId`) and last-write-wins, which is the intended behavior.
- **VALIDATE**: `cd core && npm test -- graphRunner`.

### Task 3: Add `enqueueExecutorResume` to executor
- **ACTION**: Edit `core/src/agents/executor.ts`.
- **IMPLEMENT**:
  ```ts
  export function enqueueExecutorResume(
    task: Task,
    project: Project,
    options: { resumeFromNodeId: string },
  ): void {
    enqueue(task, project, options);
  }
  ```
  Then thread `options` through `enqueue` → `run` → into the `runGraph` call site (the existing `useGraphRunner` branch). The legacy single-node path **does not support resume** (only one node exists); per-node retry on a legacy task falls back to whole-task retry — the route handler enforces this.
- **MIRROR**: existing `enqueue` signature at `executor.ts:83`.
- **GOTCHA**:
  1. `RUNNING` map keys by `taskId` only — there is no per-node controller and we are NOT introducing one. Per-node abort = task-level abort that happens to land mid-node-N.
  2. The `acquireSlot` semantics (executor.ts:35) already serialize per-task; no race risk introducing resume.
- **VALIDATE**: typecheck clean.

### Task 4: Add per-node abort/retry routes
- **ACTION**: Edit `core/src/routes/tasks.ts`.
- **IMPLEMENT**:
  ```ts
  router.post("/:id/nodes/:nodeId/abort", async (req, res) => {
    try {
      const { id, nodeId } = req.params as { id: string; nodeId: string };
      const task = await getTask(id);
      if (!task) return res.status(404).json({ error: "not_found" });
      if (!isExecutorRunning(id)) {
        return res.status(409).json({ error: "task_not_running" });
      }
      const runs = listNodeRunsByTask(id);
      const live = runs.find((r) => r.nodeId === nodeId && r.status === "running");
      if (!live) return res.status(409).json({ error: "node_not_running" });
      abortExecutor(id);
      return res.json({ aborted: true, nodeId });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post("/:id/nodes/:nodeId/retry", async (req, res) => {
    try {
      const { id, nodeId } = req.params as { id: string; nodeId: string };
      const task = await getTask(id);
      if (!task) return res.status(404).json({ error: "not_found" });
      if (task.status !== "doing") {
        return res.status(400).json({ error: "task_not_in_doing" });
      }
      const project = await getProject(task.projectId);
      if (!project) return res.status(404).json({ error: "project_not_found" });

      const graph = loadGraph(project.repoPath);
      if (!graph || graph.nodes.length < 2) {
        return res.status(400).json({ error: "no_graph_use_task_retry" });
      }
      const plan = planGraph(graph);
      if (!plan.order.includes(nodeId)) {
        return res.status(400).json({ error: "node_not_in_graph" });
      }

      if (isExecutorRunning(id)) {
        abortExecutor(id);
        await waitForExecutorIdle(id, 5000);
      }

      const reset = await updateTask(id, {
        agent: { status: "idle", currentStep: undefined, log: [], error: null,
                 startedAt: null, finishedAt: null },
      });
      broadcastTaskUpdated(reset);
      res.json({ task: reset, resumeFromNodeId: nodeId });
      enqueueExecutorResume(reset, project, { resumeFromNodeId: nodeId });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });
  ```
- **MIRROR**: `tasks.ts:205-275` for envelope shapes, `broadcastTaskUpdated` placement, and the abort-then-wait dance.
- **IMPORTS**: add `loadGraph` from `../services/graphService.js`, `planGraph` from `../agents/graphRunner.js`, `enqueueExecutorResume` from `../agents/executor.js`, `listNodeRunsByTask` from `../services/taskService.js`.
- **GOTCHA**:
  1. Mounting order: `tasks.ts` is mounted at `/api/tasks` in `index.ts`. Place these routes near abort/retry for cohesion. `/:id/nodes/...` does not collide with `/:id` because the next segment differs.
  2. Per-node abort returns `409 node_not_running` if the named node isn't the currently-running one — this prevents users aborting a node that already finished.
- **VALIDATE**: manual `curl` against a live 3-node task.

### Task 5: Insert `planGraph` validation into graph PUT route
- **ACTION**: Edit `core/src/routes/projectsClaude.ts`.
- **IMPLEMENT**: Between `parsed.success` check (line 673) and `fs.writeFileSync` (line 691):
  ```ts
  if (parsed.data.nodes.length > 0) {
    try {
      planGraph(parsed.data);
    } catch (err) {
      if (err instanceof GraphValidationError) {
        return res.status(400).json({
          error: "graph_invalid",
          reason: err.reason,
          offendingNodeIds: err.offendingNodeIds,
        });
      }
      throw err;
    }
  }
  ```
  Special case: an empty graph (`nodes.length === 0`) is **allowed** at save time (users may clear the canvas).
- **IMPORTS**: `import { planGraph, GraphValidationError } from "../agents/graphRunner.js";`
- **GOTCHA**: `planGraph` was authored as part of `graphRunner.ts` (Phase 2). It takes pure data — no side effects. Importing it in a route is fine.
- **VALIDATE**: `curl -X PUT /api/projects/:id/claude/graph` with a cycle returns 400 `{ error: "graph_invalid", reason: "cycle", offendingNodeIds: [...] }`.

### Task 6: Add nodeRuns slice to `boardStore`
- **ACTION**: Edit `gui/src/store/boardStore.ts`.
- **IMPLEMENT**:
  ```ts
  // State
  nodeRuns: Record<string, Record<string, NodeRun>>;   // taskId -> nodeId -> NodeRun
  nodeLogs: Record<string, Record<string, string[]>>;  // taskId -> nodeId -> log lines

  // Actions
  upsertNodeRun: (run: NodeRun) => void;
  appendNodeLog: (taskId: string, nodeId: string, line: string) => void;
  clearNodeRuns: (taskId: string) => void;
  ```
  Implementation:
  ```ts
  upsertNodeRun: (run) =>
    set((s) => ({
      nodeRuns: {
        ...s.nodeRuns,
        [run.taskId]: { ...(s.nodeRuns[run.taskId] ?? {}), [run.nodeId]: run },
      },
    })),
  appendNodeLog: (taskId, nodeId, line) =>
    set((s) => {
      const perTask = s.nodeLogs[taskId] ?? {};
      const lines = perTask[nodeId] ?? [];
      const next = lines.length >= 500 ? [...lines.slice(-499), line] : [...lines, line];
      return {
        nodeLogs: { ...s.nodeLogs, [taskId]: { ...perTask, [nodeId]: next } },
      };
    }),
  clearNodeRuns: (taskId) =>
    set((s) => {
      const { [taskId]: _r, ...restRuns } = s.nodeRuns;
      const { [taskId]: _l, ...restLogs } = s.nodeLogs;
      return { nodeRuns: restRuns, nodeLogs: restLogs };
    }),
  ```
- **MIRROR**: existing `appendLog` ring-buffer at `boardStore.ts:201-209` (cap of 500 lines).
- **IMPORTS**: existing `NodeRun` import from `@/types`.
- **GOTCHA**: Keep `nodeRuns` keyed by `nodeId` (not `nodeRunId`) — when a node retries, the new running NodeRun overwrites the old done one.
- **VALIDATE**: `cd gui && pnpm typecheck`.

### Task 7: Wire WS dispatch for new event types
- **ACTION**: Edit `gui/src/hooks/useAgentSocket.ts`.
- **IMPLEMENT**: Three new arms inside the `switch` (around line 100, after `agent_text`):
  ```ts
  case "node_started": {
    const m = msg as Extract<WsMessage, { type: "node_started" }>;
    upsertNodeRun(m.payload);
    break;
  }
  case "node_finished": {
    const m = msg as Extract<WsMessage, { type: "node_finished" }>;
    upsertNodeRun(m.payload);
    break;
  }
  case "node_log": {
    const m = msg as Extract<WsMessage, { type: "node_log" }>;
    appendNodeLog(m.taskId, m.payload.nodeId, m.payload.line);
    break;
  }
  ```
  Add `upsertNodeRun, appendNodeLog` to the destructure at line 21.
- **MIRROR**: `agent_log` arm at `useAgentSocket.ts:81-85`.
- **GOTCHA**: Discriminated union in `gui/src/types/index.ts` already includes the three variants (Phase 1). No type changes needed here.
- **VALIDATE**: typecheck; manual: open DevTools WS frames, drag a 3-node task, see `node_started/finished/log` consumed.

### Task 8: Surface `runState` on `AgentNodeData` and render in `AgentNode.tsx`
- **ACTION**: Edit `gui/src/components/Studio/AgentNode.tsx` and `StudioCanvas.tsx`.
- **IMPLEMENT (AgentNode.tsx)**:
  ```ts
  export interface AgentNodeData {
    agent: ClaudeAgent;
    onEdit: (slug: string) => void;
    onRemoveSkill: (slug: string, skillId: string) => void;
    onAddSkill: (slug: string, skillId: string) => void;
    runState?: {
      status: NodeRunStatus;
      nodeRunId: string;
      tokens?: { input: number; output: number };
      model?: string | null;
    };
    onAbortNode?: (nodeId: string) => void;
    onRetryNode?: (nodeId: string) => void;
    onSelectNode?: (nodeId: string) => void;
    validationError?: { reason: string };
  }
  ```
  Render: outer `<div className={cn("agent-node", runState && `agent-node--${runState.status}`, validationError && "agent-node--invalid")}>`. When `runState?.status === "running"`, show an `Abort` button calling `onAbortNode(slug)`. When `error` or `aborted`, show `Retry`.
- **IMPLEMENT (StudioCanvas.tsx)**:
  - Add prop `taskId?: string`.
  - Read `nodeRuns = useBoardStore(s => s.nodeRuns[taskId ?? ""] ?? {})`.
  - In `buildNodes`, merge `runState: nodeRuns[agent.slug]` and `onAbortNode/onRetryNode/onSelectNode` callbacks.
  - On save error from `putProjectGraph`, parse `{ reason, offendingNodeIds }` and set local `validation: { reason, ids: Set<string> }` state. Pass `validationError: validation.ids.has(slug) ? { reason } : undefined` per node.
- **MIRROR**: existing `data` shape passed at `StudioCanvas.tsx:42` and ReactFlow custom-node pattern.
- **GOTCHA**:
  1. Graph node `id` and agent `slug` are the same in current Studio (`StudioCanvas.tsx:40` sets `id: agent.slug`). When iterating runs by `nodeId`, use `agent.slug` as the lookup key.
  2. CSS: status colors must come from existing tokens — `var(--status-running)`, `var(--status-error)`, etc. Do not introduce new color tokens.
- **VALIDATE**: typecheck; visual: a running task highlights one node with the running ring.

### Task 9: NodeRunPanel (right pane)
- **ACTION**: Create `gui/src/components/Studio/NodeRunPanel.tsx`.
- **IMPLEMENT**:
  ```tsx
  interface NodeRunPanelProps {
    taskId: string;
    nodeId: string | null;
    onClose: () => void;
  }
  export function NodeRunPanel({ taskId, nodeId, onClose }: NodeRunPanelProps) {
    const run = useBoardStore((s) => (nodeId ? s.nodeRuns[taskId]?.[nodeId] : undefined));
    const log = useBoardStore((s) => (nodeId ? s.nodeLogs[taskId]?.[nodeId] ?? [] : []));
    if (!nodeId) return null;
    return (
      <aside className="border-l border-[var(--border)] w-[360px] shrink-0 flex flex-col">
        <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <span className="text-[12px]">{nodeId}</span>
          <button onClick={onClose}>×</button>
        </header>
        {run && (
          <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">
            <div>Status: {run.status}</div>
            <div>Model: {run.model ?? "—"}</div>
            <div>In: {run.inputTokens} / Out: {run.outputTokens}</div>
            <div>Started: {run.startedAt}</div>
            {run.finishedAt && <div>Finished: {run.finishedAt}</div>}
          </div>
        )}
        <pre className="flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px] font-mono">
          {log.join("\n")}
        </pre>
      </aside>
    );
  }
  ```
- **MIRROR**: `gui/src/components/Card/CommentsTab.tsx:90-100` for log rendering and font/spacing.
- **GOTCHA**: `pre` element with `whitespace-pre-wrap` keeps long lines wrapped without horizontal scroll, matching the existing TaskDetailDrawer log pane.
- **VALIDATE**: typecheck; visual: clicking a running node opens panel and streams.

### Task 10: Wire abort/retry buttons through to API
- **ACTION**: Edit `gui/src/lib/api.ts` and `StudioCanvas.tsx`.
- **IMPLEMENT (api.ts)**:
  ```ts
  abortNode: (taskId: string, nodeId: string): Promise<{ aborted: true; nodeId: string }> =>
    fetch(`${BASE}/tasks/${taskId}/nodes/${encodeURIComponent(nodeId)}/abort`, {
      method: "POST",
    }).then((r) => handle<{ aborted: true; nodeId: string }>(r)),

  retryNode: (taskId: string, nodeId: string): Promise<{ task: Task; resumeFromNodeId: string }> =>
    fetch(`${BASE}/tasks/${taskId}/nodes/${encodeURIComponent(nodeId)}/retry`, {
      method: "POST",
    }).then((r) => handle<{ task: Task; resumeFromNodeId: string }>(r)),
  ```
  And widen the `putProjectGraph` error response: `handle` already returns the JSON body on 4xx via the existing `ApiError` shape — verify and surface `reason`/`offendingNodeIds` to the caller.
- **IMPLEMENT (StudioCanvas.tsx)**:
  ```ts
  const onAbortNode = useCallback(async (nodeId: string) => {
    if (!taskId) return;
    await api.abortNode(taskId, nodeId).catch(() => {});
  }, [taskId]);
  const onRetryNode = useCallback(async (nodeId: string) => {
    if (!taskId) return;
    await api.retryNode(taskId, nodeId).catch(() => {});
  }, [taskId]);
  ```
- **GOTCHA**: 409 `node_not_running` is expected if the user clicks Abort just as the node finishes. Swallow with a soft toast; don't block the UI.
- **VALIDATE**: end-to-end: click Abort on a running coder, see graphRunner finish coder row as `aborted`, reviewer never starts.

### Task 11: Wire taskId into Studio entry point
- **ACTION**: Edit `gui/src/app/board/page.tsx` (or wherever Studio is mounted) and add an "Open in Studio" link in `gui/src/components/Card/TaskDetailDrawer.tsx`.
- **IMPLEMENT**:
  - Studio mount reads `searchParams.get("taskId")` and passes to `<StudioCanvas taskId={...} />`.
  - TaskDetailDrawer renders `<Link href={`/board?projectId=${task.projectId}&taskId=${task.id}&studio=1`}>Open in Studio</Link>` when graph mode is in use (heuristic: `task.agentStatus === "running"` and any `nodeRuns[task.id]` is populated).
- **MIRROR**: existing route plumbing in `gui/src/app/board/page.tsx`.
- **GOTCHA**: Studio panel may currently mount as a side-tab inside `/board`. Confirm the actual mount point; the plan's contract is "any place StudioCanvas is rendered, plumb optional `taskId`". Leave the legacy mount without `taskId` working unchanged.
- **VALIDATE**: navigate `/board?projectId=p1&taskId=t1` → Studio shows live state; without `taskId` → identical to today.

### Task 12: graphRunner unit tests for new behavior
- **ACTION**: Edit `core/src/agents/graphRunner.test.ts`.
- **IMPLEMENT** new cases:
  - `planGraph` two entries → `offendingNodeIds` lists both entry IDs.
  - `planGraph` cycle → `offendingNodeIds` lists nodes in the cycle path.
  - `planGraph` branching → `offendingNodeIds` lists the branching source.
  - `planGraph` disconnected → `offendingNodeIds` lists the unreachable nodes.
  - (Optional) integration-style test for `runGraph(..., { resumeFromNodeId: "coder-1" })` — uses a mock that asserts the planner-1 row is not re-inserted and that `prior` is seeded from the prior `done` row.
- **MIRROR**: `core/src/agents/graphRunner.test.ts` existing test layout (per Phase 2).
- **VALIDATE**: `cd core && npm test -- graphRunner` all green.

### Task 13: Documentation update (in PR body, not a separate file)
- **ACTION**: When opening the PR, include a "Studio Runtime UX" usage section: how to navigate to Studio in run-trace mode, what the colors mean, and that retries resume from the failed node forward.
- **VALIDATE**: PR body readthrough.

---

## Testing Strategy

### Unit Tests (server)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `planGraph` two entries | a, b (both no incoming) | `offendingNodeIds: [a, b]` | Yes |
| `planGraph` cycle a→b→c→a | | `offendingNodeIds: [a, b, c]` | Yes |
| `planGraph` branching a→b, a→c | | `offendingNodeIds: [a]` | Yes |
| `planGraph` disconnected (a→b, c) | | `offendingNodeIds: [c]` | Yes |
| `runGraph` resume at second node | seeded `done` row for first node | first node not re-inserted; second node receives prior artifact | Yes |
| `runGraph` resume at unknown node | `resumeFromNodeId: "ghost"` | throws `Error("not in plan")` | Yes |
| `runGraph` resume but prior node has no `done` row | | throws | Yes |

### Integration / Manual Tests

| Scenario | Expected |
|---|---|
| Save graph with cycle | `PUT /claude/graph` → 400 `{ reason: "cycle", offendingNodeIds: [...] }`; canvas shows red borders on cycle nodes |
| Save valid linear graph | 200; canvas clears any prior validation chips |
| Save empty graph (`nodes: []`) | 200 (preserves Phase 2 behavior) |
| Drag 3-node task to `doing`, observe Studio with `?taskId=` | planner node shows running ring → done; coder running → done; reviewer running → done |
| Click Abort on running coder | Coder row becomes `aborted`; reviewer row never inserted; task rolls back to `todo` |
| Click Retry on aborted coder | Planner row stays `done`; new coder row inserted as `running`; reviewer runs after coder; PR opens |
| Retry on a node before any prior `done` row exists | 400 `cannot_resume` |
| Retry on a legacy single-node graph task | 400 `no_graph_use_task_retry` (user falls back to whole-task retry) |

### Edge Cases Checklist
- [x] Cycle detection captures the cycle path, not just one node
- [x] Branching offending source listed
- [x] Empty graph saves successfully (clearing canvas)
- [x] Per-node abort while node already finished → 409 (no double-abort)
- [x] Retry while task is not in `doing` → 400
- [x] Retry on a graph that no longer matches the saved one (user edited graph mid-task) → 400 `node_not_in_graph`
- [ ] Concurrent comment-runner during graph retry — comment runner already serializes via slot lock; document but do not test

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
cd gui && pnpm typecheck
```
EXPECT: zero errors.

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: clean.

### Unit Tests
```bash
cd core && npm test
```
EXPECT: existing graphRunner suite + new resume + new validation cases all green.

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: clean.

### Manual end-to-end
- [ ] Create test project with `.claude/agents/{planner,coder,reviewer}.md` and a 3-node `_graph.json`.
- [ ] Open `/board?projectId=<id>&taskId=<id>&studio=1`.
- [ ] Drag task `todo → doing`. Watch the planner node light up running, then done; coder running; etc.
- [ ] Click the running coder node → NodeRunPanel opens, log streams.
- [ ] Click Abort on coder. Verify:
  - `task_node_runs` row for coder = `aborted`
  - reviewer row never created
  - task rolled back to `todo` (existing executor behavior)
- [ ] Drag back to `doing`, then click Retry on coder once it errors.
  - Planner row from prior attempt stays `done`
  - New coder row inserted as `running`, then `done`
  - Reviewer runs after, PR opens
- [ ] Edit graph in Studio to introduce a cycle, click Save. Verify:
  - 400 response surfaces inline with red borders on cycle nodes + toast `"Graph invalid: cycle"`
  - Disk file unchanged (`cat .claude/agents/_graph.json` shows previous valid state)

---

## Acceptance Criteria
- [ ] All 13 tasks completed
- [ ] All validation commands pass
- [ ] graphRunner tests cover new `offendingNodeIds` and resume cases
- [ ] Studio canvas with `?taskId=` shows live status colors during a 3-node run
- [ ] Per-node Abort cancels just the in-flight node (downstream nodes never start)
- [ ] Per-node Retry resumes from the named node forward, reusing prior artifacts
- [ ] Saving a cyclic / branching / disconnected graph fails with 400 + inline UI diagnostics
- [ ] Saving an empty graph still succeeds (Phase 2 parity)
- [ ] Legacy single-node tasks unchanged — Studio without `taskId` is identical to today
- [ ] No type errors, no lint errors

## Completion Checklist
- [ ] Code follows discovered patterns (NodeRun lifecycle, abort via `RUNNING` map, route envelope shapes)
- [ ] Error handling matches codebase style (`{ error: <code> }` envelopes, 4xx vs 5xx semantics)
- [ ] No new state machine — reuses existing `RUNNING` map and `acquireSlot`
- [ ] No hardcoded values (status colors via `var(--status-*)` tokens)
- [ ] Self-contained — implementer doesn't need to re-search for graph save endpoint, NodeRun shape, or AbortController location

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Resume seeds stale artifact** — user edits source between runs; prior `outputArtifact.diff` references commits that no longer exist | M | M | Document explicitly; on retry, the resumed node's first action is typically `git status` + `git diff` which reveals the discrepancy. Phase 4 may stamp `gitHead` into each artifact. |
| **Per-node abort race** — user clicks Abort the instant after the running node calls `updateNodeRun(..., status:"done")` but before `runGraph` advances to the next node; route returns 409 `node_not_running` even though the chain is still progressing | M | L | Accept; document. Soft-toast on 409. The whole-task abort still works as escape hatch. |
| **Graph mutation between original run and retry** — user edits graph after a failed run, then clicks Retry on a node that no longer exists in the new graph | L | M | Route handler validates `plan.order.includes(nodeId)` before resuming → 400 `node_not_in_graph`. |
| **Studio binds to a stale taskId after task moves to `done`** — node ring stays on last status forever | L | L | When `task.status` transitions out of `doing`, clear `nodeRuns[taskId]` after a 30s grace. |
| **Validation message UX** — `offendingNodeIds: ["a","b","c"]` is opaque to users who think in slugs | L | L | The current Studio uses `agent.slug` as both `id` and display label, so node IDs are already human-readable. |
| **Cycle detection captures wrong path** — depending on traversal order, the throw site may include nodes that are not actually in the cycle | M | L | Tests cover canonical cycle shapes; the offending list is best-effort guidance, not authoritative. UI shows a generic "cycle" message alongside the IDs. |
| **GUI store growth** — `nodeLogs` keyed by `taskId` accumulates indefinitely if user views many tasks | L | L | Each per-node log is capped at 500 lines (mirrors `appendLog`). `clearNodeRuns(taskId)` is called when leaving the board for that project. |
| **Retry endpoint reuses `enqueue` slot lock** — if a stale executor is still mid-cleanup, the new run blocks for up to 5s | M | L | Existing `waitForExecutorIdle(id, 5000)` already handles this; if it times out, route returns 500 and user retries. |

## Notes

- This phase deliberately does **not** introduce a per-node `AbortController`. The single per-task controller is sufficient because graphRunner already checks `signal.aborted` between nodes and `runClaude` already accepts the signal — abort granularity is "the node currently in-flight, plus all downstream nodes."
- Resume semantics intentionally do not delete the prior failed/aborted `task_node_runs` row. Keeping the historical row is what the Phase 6 `/insights` dashboard will need to compute retry rate. The GUI's `boardStore.nodeRuns` map keys by `nodeId` and last-write-wins, so the user sees only the latest attempt — but the database remains a complete audit trail.
- "Open in Studio" link from TaskDetailDrawer is the discoverability path: users won't randomly type `?taskId=` into the URL. Phase 4 may inline the canvas as a tab inside the drawer, but for v1 it stays a separate Studio view to keep this phase small.
- The Phase 2 plan's "Phase 3 may rewrite topology sync" note is **not** acted on here — `claudeTopologySyncService` continues to write the same `CLAUDE.md` block. Run-trace UX does not depend on `CLAUDE.md`.
