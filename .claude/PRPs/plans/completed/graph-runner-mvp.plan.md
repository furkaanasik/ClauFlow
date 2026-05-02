# Plan: Phase 2 Graph Runner MVP

## Summary

Make the Studio graph (`.claude/agents/_graph.json`) drive task execution end-to-end. A new `graphRunner.ts` walks the graph node-by-node, invoking `claude` per node with its own prompt + allowed-tools, passing structured artifacts between nodes, and emitting per-node WS events. The existing `executor.ts` keeps its legacy single-claude path for projects with empty/single-node graphs, and the commit/push/PR-create finalization is shared between both paths. No new kanban columns yet (Phase 4 adds CI), no UX polish on the Studio canvas (Phase 3 adds run-trace overlay).

## User Story

As a **ClauFlow user who already authors `.claude/agents/<slug>.md` files in the Studio**, I want **the graph I draw on the canvas to actually drive task execution**, so that **I can decompose work across `planner` → `coder` → `reviewer` agents (each with its own prompt, tools, and emitted artifacts) instead of one monolithic claude session.**

## Problem → Solution

**Current state**: every task in `doing` runs through a single `claude` process via `executor.ts:run()`. The Studio graph in `_graph.json` is stored, validated by zod, synced to `CLAUDE.md` via `claudeTopologySyncService` — but **no consumer reads it at runtime**. Edges are dead data.
**Desired state**: when a task enters `doing`, the executor reads `_graph.json`. If the graph has ≥2 nodes connected in a linear chain, `graphRunner` walks it: each node = one `claude` invocation with its agent's frontmatter+body as the prompt, allowed-tools list, and the prior node's output as structured input. Per-node `task_node_runs` rows replace the single legacy row. Last node hands off to the existing commit/push/PR flow.

## Metadata
- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/orchestration-ci-observability.prd.md](.claude/PRPs/prds/orchestration-ci-observability.prd.md)
- **PRD Phase**: Phase 2 — Graph Runner MVP (Bet 1)
- **Estimated Files**: ~10 (3 new, 7 edits)

---

## UX Design

### Before
```
todo → [drag] → doing
                 │
                 ▼
        single claude run
                 │
                 ▼
         git commit + push
                 │
                 ▼
              gh pr create
                 │
                 ▼
              review/done
```
TaskDetailDrawer: one log stream, one tool-call timeline, one cost number.

### After
```
todo → [drag] → doing
                 │
                 ▼
            ┌─ graph runner reads _graph.json ─┐
            │                                  │
            ▼                                  ▼
       1-node graph?                     ≥2-node graph?
            │                                  │
       legacy path                  walk: planner → coder → reviewer
            │                       (each = own claude + own tools +
            │                        prior artifact as input)
            │                                  │
            └────► shared finalizer ◄──────────┘
                          │
                          ▼
              git commit + push + PR
                          │
                          ▼
                       review/done
```
TaskDetailDrawer: same WS stream, but `agent_log`/`agent_text`/`agent_tool_call` events now carry an optional `nodeId` field. **No new UI in this phase** — events are visible but not visually grouped by node yet (Phase 3).

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Drag `todo → doing` | One claude run | Graph-driven N runs OR one legacy run | Routing decided by `_graph.json` content |
| `task_node_runs` rows per task | 1 (`legacy:coder`) | 1 per node (real `nodeId`s like `planner-1`, `coder-1`) OR 1 legacy if no graph | |
| WS `agent_log` events | No `nodeId` field | Optional `nodeId` field on `payload` (additive) | Existing GUI ignores extra fields |
| Per-node `task_node_runs.model` | `null` (Phase 1) | Set from agent frontmatter `model:` if present | |
| Allowed tools | Hardcoded `[Read,Write,Edit,Bash,Glob,Grep]` | Per-node from agent frontmatter `allowedTools:` (CSV); falls back to hardcoded if missing | |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | [core/src/agents/executor.ts](core/src/agents/executor.ts) | 136–520 | The full `run()` flow this plan refactors; commit/push/PR section becomes shared finalizer |
| P0 | [core/src/agents/executor.ts](core/src/agents/executor.ts) | 1–50 | Slot lock, `RUNNING` map, abort semantics — must be preserved by graphRunner |
| P0 | [core/src/routes/projectsClaude.ts](core/src/routes/projectsClaude.ts) | 165–250 | `parseAgentFile`, `serializeAgentFile`, `AgentFrontmatter`; extend with `allowedTools` |
| P0 | [core/src/routes/projectsClaude.ts](core/src/routes/projectsClaude.ts) | 639–748 | `_graph.json` read/write, zod schemas — graphRunner uses identical loader |
| P0 | [core/src/services/claudeService.ts](core/src/services/claudeService.ts) | 193–340 | `runClaude` signature + retry semantics (reused per node) |
| P0 | [core/src/services/taskService.ts](core/src/services/taskService.ts) | 1305–1500 | `insertNodeRun`/`updateNodeRun` API (Phase 1) |
| P0 | [core/src/agents/projectPlanner.ts](core/src/agents/projectPlanner.ts) | 171–260 | A working multi-step claude invocation pattern: prompt-build, runClaude options, error handling |
| P1 | [core/src/types/index.ts](core/src/types/index.ts) | 200–240 | `AgentGraph`/`AgentGraphNode`/`AgentGraphEdge` shape |
| P1 | [core/src/services/wsService.ts](core/src/services/wsService.ts) | all | `broadcastNode*` helpers (Phase 1, env-gated). This phase removes the gate. |
| P1 | [core/src/services/claudeTopologySyncService.ts](core/src/services/claudeTopologySyncService.ts) | all | Reference: how the graph is interpreted for `CLAUDE.md` sync |
| P2 | [core/src/services/taskService.nodeRuns.test.ts](core/src/services/taskService.nodeRuns.test.ts) | all | Vitest pattern with self-cleaning `afterAll` |

## External Documentation

No external research needed — feature uses established internal patterns (`runClaude`, `parseAgentFile`, `_graph.json` loader, `task_node_runs` CRUD).

---

## Patterns to Mirror

### GRAPH_LOAD_AND_VALIDATE
```ts
// SOURCE: core/src/routes/projectsClaude.ts:639-714
function graphFilePath(repoPath: string): string {
  return path.join(agentsDir(repoPath), "_graph.json");
}

const graphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(500),
  edges: z.array(graphEdgeSchema).max(2000),
});

// Read pattern
const file = graphFilePath(project.repoPath);
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = graphSchema.safeParse(JSON.parse(raw));
  if (parsed.success) return parsed.data;
}
```
graphRunner reuses this loader verbatim — extract into a shared helper instead of duplicating.

### AGENT_FILE_PARSE
```ts
// SOURCE: core/src/routes/projectsClaude.ts:177-209
interface AgentFrontmatter {
  name?: string;
  model?: string;
  description?: string;
  [key: string]: string | undefined;
}

function parseAgentFile(raw: string): ParsedAgent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  // ... line-by-line YAML-ish parser
}
```
Extend `AgentFrontmatter` with `allowedTools?: string` (CSV); split on `,` and trim at parse time. `serializeAgentFile`'s `keys` array gains `"allowedTools"` so writes round-trip.

### CLAUDE_RUN_INVOCATION
```ts
// SOURCE: core/src/agents/projectPlanner.ts:229-248
const result = await runClaude({
  prompt: systemPrompt,
  cwd,
  outputFormat: "json",
  maxOutputTokens: 32000,
  allowedTools: repoExists ? ["Read", "Glob", "Grep"] : undefined,
});

if (result.code !== 0) {
  throw new Error(
    `claude CLI exited ${result.code}: ${result.stderr.slice(0, 500)}`,
  );
}
```
Per-node call uses the **stream-json** variant (with all the `onLine`/`onText`/`onToolCallStart`/`onToolCallEnd`/`onResult` callbacks) — same pattern as [executor.ts:304](core/src/agents/executor.ts#L304). Wire all callbacks to also tag events with the current node's id.

### NODE_RUN_LIFECYCLE
```ts
// SOURCE: core/src/agents/executor.ts:139-160 + finalizeNodeRun
const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;
const nodeRun = insertNodeRun({
  id: nodeRunId,
  taskId: task.id,
  nodeId: graphNodeId,           // real id like "planner-1"
  nodeType: agentTypeFromSlug,   // "planner" | "coder" | "reviewer" | "custom"
  status: "running",
  startedAt: new Date().toISOString(),
  inputArtifact: priorArtifact,  // structured JSON from prior node
  model: frontmatter.model ?? null,
});
broadcastNodeStarted(nodeRun);
// ... run claude ...
updateNodeRun(nodeRunId, {
  status: "done",
  finishedAt: new Date().toISOString(),
  outputArtifact: artifact,
  inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
});
```

### ABORT_HANDLING
```ts
// SOURCE: core/src/agents/executor.ts:48-56, 138-141
const RUNNING = new Map<string, AbortController>();

export function abort(taskId: string): boolean {
  const ctrl = RUNNING.get(taskId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

// inside run():
const controller = new AbortController();
RUNNING.set(task.id, controller);
// pass controller.signal into runClaude per-node
```
graphRunner uses **the same** `RUNNING` map and `AbortController` — abort cancels the current node's claude, then graph walker checks `signal.aborted` between nodes and stops.

### TEST_STRUCTURE_SELF_CLEANING
```ts
// SOURCE: core/src/services/taskService.nodeRuns.test.ts:1-45
const SUFFIX = `nrtest_${Date.now()}`;
let projectId = ""; let taskId = "";

beforeAll(async () => {
  const project = await createProject({ name: `... ${SUFFIX}`, ... });
  projectId = project.id;
  // create task ...
});

afterAll(() => {
  if (taskId) db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  if (projectId) db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
});
```
graphRunner unit tests follow this pattern.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/services/graphService.ts` | CREATE | Extract graph loader + agent-file loader from `projectsClaude.ts` so both routes and graphRunner share one implementation |
| `core/src/agents/graphRunner.ts` | CREATE | New executor for ≥2-node graphs |
| `core/src/agents/graphRunner.test.ts` | CREATE | Unit tests for topological-order, single-entry/single-terminal validation, abort propagation |
| `core/src/agents/executor.ts` | UPDATE | Route to graphRunner when graph is non-trivial; extract finalizer (commit/push/PR) into shared module |
| `core/src/agents/finalizer.ts` | CREATE | Shared commit/push/PR-create logic, currently inline at executor.ts:347-510 |
| `core/src/routes/projectsClaude.ts` | UPDATE | Extend `AgentFrontmatter` with `allowedTools`; update `parseAgentFile` + `serializeAgentFile` + `agentBodySchema` zod |
| `core/src/services/wsService.ts` | UPDATE | Remove `CLAUFLOW_NODE_EVENTS` env gate — events are real now |
| `core/src/services/claudeTopologySyncService.ts` | UPDATE (minor) | If it consumed `_graph.json` or agent meta, ensure `allowedTools` field doesn't break it |
| `core/src/types/index.ts` | UPDATE | Add optional `allowedTools?: string[]` to a new `AgentDefinition` shape (server-internal); add optional `nodeId?: string` to `agent_log`/`agent_text`/`agent_tool_call` payloads |
| `gui/src/types/index.ts` | UPDATE | Mirror optional `nodeId?` on the same WS variants |

## NOT Building

- **Studio canvas run-trace overlay** (highlight active/done/failed node) — Phase 3.
- **Per-node abort/retry endpoints** (`POST /api/tasks/:id/nodes/:nodeId/abort|retry`) — Phase 3.
- **CI node, fix loop, cyclic edges** — Phase 4.
- **Per-task USD budget / cost guard** — Phase 5.
- **`/insights` dashboard** — Phase 6.
- **Multi-model executor (Codex/Gemini)** — `model` field is stored per-node-run but the runtime still calls `claude` only.
- **Per-node git worktrees** — single shared working tree (deferred per PRD Decisions Log).
- **Comment-runner integration with graph nodes** — comment runs stay outside `task_node_runs` for v2; revisit later.
- **Auto-bootstrapping default `planner.md` / `coder.md` / `reviewer.md`** — users author their own; we document a recommended starting set in the PR description.
- **Removing `bypassPermissions`** — flagged in PRD Open Question #5; per-node tool whitelists make it possible but the actual removal is a separate cleanup PR.

---

## Step-by-Step Tasks

### Task 1: Extract `graphService.ts` (graph + agent-file loader)
- **ACTION**: Create `core/src/services/graphService.ts`.
- **IMPLEMENT**:
  ```ts
  import fs from "node:fs";
  import path from "node:path";
  import { z } from "zod";
  import type { AgentGraph } from "../types/index.js";

  export const graphNodeSchema = z.object({
    id: z.string().min(1).max(120),
    type: z.literal("agent"),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.object({ slug: z.string().min(1).max(120) }),
  });
  export const graphEdgeSchema = z.object({
    id: z.string().min(1).max(240),
    source: z.string().min(1).max(120),
    target: z.string().min(1).max(120),
  });
  export const graphSchema = z.object({
    nodes: z.array(graphNodeSchema).max(500),
    edges: z.array(graphEdgeSchema).max(2000),
  });

  export function agentsDir(repoPath: string): string {
    return path.join(repoPath, ".claude", "agents");
  }
  export function agentFilePath(repoPath: string, slug: string): string {
    return path.join(agentsDir(repoPath), `${slug}.md`);
  }
  export function graphFilePath(repoPath: string): string {
    return path.join(agentsDir(repoPath), "_graph.json");
  }

  export function loadGraph(repoPath: string): AgentGraph | null {
    const file = graphFilePath(repoPath);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = graphSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  export interface AgentFrontmatter {
    name?: string;
    model?: string;
    description?: string;
    allowedTools?: string;
    [key: string]: string | undefined;
  }
  export interface ParsedAgent {
    frontmatter: AgentFrontmatter;
    body: string;
  }

  export function parseAgentFile(raw: string): ParsedAgent { /* moved verbatim from projectsClaude.ts */ }
  export function serializeAgentFile(fm: AgentFrontmatter, body: string): string { /* moved + add allowedTools to keys */ }

  export interface AgentDefinition {
    slug: string;
    frontmatter: AgentFrontmatter;
    body: string;
    allowedTools: string[] | null;
  }

  export function loadAgentDefinition(
    repoPath: string,
    slug: string,
  ): AgentDefinition | null {
    const file = agentFilePath(repoPath, slug);
    if (!fs.existsSync(file)) return null;
    const { frontmatter, body } = parseAgentFile(fs.readFileSync(file, "utf8"));
    const tools =
      frontmatter.allowedTools && frontmatter.allowedTools.trim()
        ? frontmatter.allowedTools.split(",").map((t) => t.trim()).filter(Boolean)
        : null;
    return { slug, frontmatter, body, allowedTools: tools };
  }
  ```
- **MIRROR**: `projectsClaude.ts:177-250, 639-714` (move, don't duplicate).
- **IMPORTS**: as shown.
- **GOTCHA**: Tests for the `agentBodySchema` zod in `projectsClaude.ts` may now reference the moved `graphSchema` — keep re-exports if needed for backward compat. Don't change the wire format.
- **VALIDATE**: `cd core && npm run typecheck` clean.

### Task 2: Update `projectsClaude.ts` to import from `graphService`
- **ACTION**: Edit `core/src/routes/projectsClaude.ts`.
- **IMPLEMENT**: Replace local `graphFilePath`, `agentsDir`, `agentFilePath`, `parseAgentFile`, `serializeAgentFile`, `AgentFrontmatter`, `graphNodeSchema`, `graphEdgeSchema`, `graphSchema` with imports from `../services/graphService.js`. Extend the inline `agentBodySchema` to include `allowedTools: z.string().max(500).optional()`.
- **MIRROR**: existing import block at top of the file.
- **IMPORTS**: `import { ... } from "../services/graphService.js";`
- **GOTCHA**: `serializeAgentFile`'s frontmatter key list must include `"allowedTools"` so user-edited values round-trip. The order in the `keys` array determines write order — put `allowedTools` last for stability.
- **VALIDATE**: `cd core && npm run typecheck` clean; existing graph GET/PUT routes still work; `curl -X PUT /api/projects/:id/claude/graph` round-trips unchanged.

### Task 3: Add `allowedTools` to agent edit/create UI types (GUI types only — no UI in this phase)
- **ACTION**: Edit `gui/src/types/index.ts`.
- **IMPLEMENT**: Add `allowedTools?: string` to whatever GUI-side `AgentFrontmatter`-shaped interface exists (search for `name?: string; model?: string` in gui types). If none, this becomes part of Task 11.
- **VALIDATE**: `cd gui && pnpm typecheck` clean.

### Task 4: Extend `task_node_runs` insert/update to accept `inputArtifact` JSON object
- **ACTION**: No code change — Phase 1 already supports `inputArtifact: Record<string, unknown> | null` end-to-end. This task is a verification step.
- **VALIDATE**: Re-read [taskService.ts:1305+](core/src/services/taskService.ts#L1305) `InsertNodeRunInput` and `UpdateNodeRunPatch` — confirm they accept structured artifact objects. They do. Mark complete in todos.

### Task 5: Define artifact shape + topological walker in `graphRunner.ts`
- **ACTION**: Create `core/src/agents/graphRunner.ts` (skeleton only — full body in Task 6).
- **IMPLEMENT**:
  ```ts
  export interface NodeArtifact {
    /** Free-text output of the previous node (concatenated agent_text events). */
    text: string;
    /** Set after the coder node by reading `git diff base..HEAD`. Null until then. */
    diff: string | null;
    /** Per-node extras the agent decided to surface. Always present, may be empty. */
    extra: Record<string, unknown>;
  }

  export interface GraphPlan {
    /** Linear node order; ids match graph.nodes[].id. */
    order: string[];
    /** slug for each node id (resolved at plan time). */
    slugBySlugId: Record<string, string>;
  }

  export class GraphValidationError extends Error {
    constructor(public reason: "no_nodes" | "no_entry" | "multiple_entries" | "cycle" | "missing_slug" | "branching") {
      super(`Graph validation failed: ${reason}`);
    }
  }

  export function planGraph(graph: AgentGraph): GraphPlan {
    if (graph.nodes.length === 0) throw new GraphValidationError("no_nodes");
    const incoming = new Map<string, number>();
    for (const n of graph.nodes) incoming.set(n.id, 0);
    for (const e of graph.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    const entries = [...incoming.entries()].filter(([, c]) => c === 0).map(([id]) => id);
    if (entries.length === 0) throw new GraphValidationError("no_entry");
    if (entries.length > 1) throw new GraphValidationError("multiple_entries");

    // Linear walk; reject branching (out-degree > 1) and cycles
    const outBySource = new Map<string, string[]>();
    for (const e of graph.edges) {
      const arr = outBySource.get(e.source) ?? [];
      arr.push(e.target);
      outBySource.set(e.source, arr);
    }
    for (const [, targets] of outBySource) {
      if (targets.length > 1) throw new GraphValidationError("branching");
    }
    const order: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = entries[0];
    while (cur) {
      if (seen.has(cur)) throw new GraphValidationError("cycle");
      seen.add(cur);
      order.push(cur);
      cur = outBySource.get(cur)?.[0];
    }
    if (order.length !== graph.nodes.length) {
      // Disconnected nodes — Phase 2 rejects them; Phase 3 may relax.
      throw new GraphValidationError("missing_slug");
    }

    const slugById: Record<string, string> = {};
    for (const n of graph.nodes) slugById[n.id] = n.data.slug;
    return { order, slugBySlugId: slugById };
  }
  ```
- **MIRROR**: zod-style explicit error variants from `claudeService.ts:227+`.
- **GOTCHA**: Phase 2 only supports linear chains. Cycles (Phase 4 fix-loop) and branching (parallel sub-paths) are explicit `GraphValidationError`s — caller maps them to a clear user-facing error string.
- **VALIDATE**: Unit tests cover all 5 error variants + happy path (Task 8).

### Task 6: Implement graphRunner main loop
- **ACTION**: Continue editing `core/src/agents/graphRunner.ts`.
- **IMPLEMENT**: Add `runGraph(task, project, graph, controller, nodeIdSeed?)`:
  1. `planGraph(graph)` — validates linear chain.
  2. For each `nodeId` in `plan.order`:
     - Resolve agent: `loadAgentDefinition(project.repoPath, plan.slugBySlugId[nodeId])`. If `null`, throw with a user-readable error (`"Agent file missing for node X (.claude/agents/Y.md)"`).
     - Decide `nodeType`: heuristic on slug — exact match `"planner"|"coder"|"reviewer"|"tester"` → that NodeType; otherwise `"custom"`. Frontmatter key `type:` (Task 12 optional) overrides.
     - `insertNodeRun({ id: noderun_<8hex>, taskId, nodeId, nodeType, model: agent.frontmatter.model ?? null, inputArtifact: priorArtifact, status: "running", startedAt: ISO })` → broadcast.
     - Build prompt: `buildNodePrompt(agent, task, project, priorArtifact)` — see Task 7.
     - Call `runClaude({ prompt, cwd: project.repoPath, allowedTools: agent.allowedTools ?? DEFAULT_TOOLS, signal: controller.signal, outputFormat: "stream-json", onLine, onText, onToolCallStart, onToolCallEnd, onResult })` — all callbacks tag events with `nodeId`.
     - Capture concatenated `onText` output as `artifact.text`. After the coder node specifically, also run `git diff <base>..HEAD` and store as `artifact.diff`.
     - On success: `updateNodeRun(id, { status: "done", finishedAt: ISO, outputArtifact: artifact, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })` → broadcast.
     - On error or abort: `updateNodeRun(id, { status: "error" | "aborted", finishedAt: ISO, errorMessage })` → broadcast → throw to caller.
     - Set `priorArtifact = artifact` for next iteration.
  3. Return final artifact + summary so executor's finalizer can build the PR body.
- **MIRROR**: `executor.ts:280-345` for the runClaude callback set; reuse `parseUsageFromResult` from `claudeService.ts`.
- **GOTCHA**:
  1. Each node's `runClaude` uses a *separate* abort check — `if (controller.signal.aborted) break;` between nodes. Fail-fast: do NOT start the next node if the prior one errored.
  2. `git diff <base>..HEAD` is computed AFTER the coder node only (heuristic by `nodeType === "coder"`). Other nodes pass `priorArtifact.diff` through unchanged.
  3. Token usage from the stream-json `result` event is per-call, not cumulative across the task — store on the per-node row (already correct shape) and additionally call existing `updateTaskUsage` to keep the per-task aggregate going.
  4. Don't recreate the `RUNNING` map — graphRunner is invoked from `executor.ts:run()` which already manages it.
- **VALIDATE**: typecheck clean; integration via Task 9.

### Task 7: Build per-node prompt with prior artifact context
- **ACTION**: Inside `graphRunner.ts`, add `buildNodePrompt(agent, task, project, priorArtifact)`.
- **IMPLEMENT**:
  ```ts
  function buildNodePrompt(
    agent: AgentDefinition,
    task: Task,
    project: Project,
    prior: NodeArtifact | null,
  ): string {
    const taskBrief = task.analysis || task.description || task.title;
    const background = project.aiPrompt?.trim();
    const priorBlock = prior
      ? `\n\nPrevious node output:\n${prior.text || "(no narrative output)"}` +
        (prior.diff ? `\n\nDiff from prior node:\n\`\`\`diff\n${prior.diff.slice(0, 30_000)}\n\`\`\`` : "")
      : "";
    return [
      agent.body.trim(),  // agent's role/responsibilities from .claude/agents/<slug>.md body
      "---",
      background ? `Project background (reference only):\n${background}` : "",
      `Current task:\n${taskBrief}`,
      priorBlock,
      "When done, exit the terminal.",
    ].filter(Boolean).join("\n\n");
  }
  ```
- **MIRROR**: `executor.ts:191-213` prompt structure (background → task brief → guidance → exit instruction).
- **GOTCHA**: Diff truncation at 30k chars — large diffs blow the context window. If the coder produces a diff bigger than this, the reviewer sees a truncated view. Acceptable for v2; Phase 4 may add summarization.
- **VALIDATE**: Unit test asserts prompt contains all four sections in order.

### Task 8: graphRunner unit tests
- **ACTION**: Create `core/src/agents/graphRunner.test.ts`.
- **IMPLEMENT**: Tests for `planGraph`:
  - Empty graph → `GraphValidationError("no_nodes")`
  - Single node → 1-element order
  - Linear 3-node chain → returns nodes in order
  - Two entry nodes → `multiple_entries`
  - All nodes have incoming edges (cycle) → `no_entry`
  - Self-cycle → `cycle`
  - Branching (out-degree 2) → `branching`
  - Disconnected node → `missing_slug` (or rename to `disconnected`)

  Plus tests for `buildNodePrompt`: includes agent body, includes prior diff when present, truncates diff at 30k.
- **MIRROR**: `core/src/services/pricingService.test.ts` style.
- **VALIDATE**: `cd core && npm test -- graphRunner` all green.

### Task 9: Extract finalizer (`commit + push + PR create`) into `core/src/agents/finalizer.ts`
- **ACTION**: Create `core/src/agents/finalizer.ts`. Move executor.ts:347-510 (everything from `// ── Step 4: git add . && commit ──` through PR open + final `updateTask({ status: finalStatus, prUrl, prNumber, ... })` call) into an exported function `finalizeTask(task, project, controller, recentLog, acceptanceCriteria)`.
- **IMPLEMENT**: Function returns `{ status: "done" | "review", prUrl: string | null, prNumber: number | null, noOp: boolean }` so caller can finalize the legacy adapter node-run row appropriately.
- **MIRROR**: existing inline code at executor.ts:347-510.
- **GOTCHA**: 
  1. `pushLog`, `pushBlock`, `pushCmdResult`, `setAgentStep` are private to executor.ts — pass them in as callbacks OR move them too. Recommend moving them into a small `core/src/agents/runtime.ts` shared by executor + graphRunner + finalizer.
  2. Acceptance-criteria extraction (`extractAcceptanceCriteria`) also moves to `runtime.ts`.
  3. `recentLog` argument: caller is responsible for grabbing the log slice (last 30 lines). Don't fetch inside finalizer.
- **VALIDATE**: typecheck clean; existing legacy task still runs end-to-end.

### Task 10: Wire executor.ts to route into graphRunner
- **ACTION**: Edit `core/src/agents/executor.ts`.
- **IMPLEMENT**: At the top of `run()`, after `acquireSlot` and the initial `setAgentStep("branching", "start")`:
  ```ts
  const graph = loadGraph(project.repoPath);
  const useGraphRunner = !!graph && graph.nodes.length >= 2;
  ```
  - If `useGraphRunner === true`: call `await runGraph(task, project, graph, controller)`. Skip the legacy single-claude block (lines 189-345). The legacy `task_node_runs` row from Phase 1 is replaced by per-node rows the runner creates.
  - If `false`: keep the existing legacy path verbatim, including the `legacy:coder` adapter row.
  - Either way, after the agent work is done, call the shared `finalizeTask(...)` from Task 9.
- **MIRROR**: existing path stays as-is in the else branch.
- **GOTCHA**:
  1. The legacy `nodeRunId` insert at executor.ts:147 must NOT fire when graphRunner is used (else there's a phantom legacy row alongside real per-node rows). Move the insert behind the `else` branch.
  2. Abort handling: same `RUNNING` map and `controller`. graphRunner uses `controller.signal` for runClaude calls and checks `signal.aborted` between nodes.
  3. The `catch` block at executor.ts:466 must still call `finalizeNodeRun` for the legacy row OR a new equivalent that errors all in-flight per-node rows. Solution: graphRunner's own try/catch finalizes each node's row before re-throwing. The outer executor catch only handles legacy.
- **VALIDATE**: 
  - With empty/1-node graph: existing flow + `task_node_runs.nodeId='legacy:coder'` row. Same as Phase 1.
  - With 3-node graph: 3 per-node rows, no legacy row.

### Task 11: Drop `CLAUFLOW_NODE_EVENTS` env gate
- **ACTION**: Edit `core/src/services/wsService.ts`.
- **IMPLEMENT**: Remove the `nodeEventsEnabled()` check inside `broadcastNodeStarted`/`broadcastNodeFinished`/`broadcastNodeLog`. Events are now real and consumed (eventually) by the GUI; gating them is no longer useful.
- **MIRROR**: existing `broadcastToolCall` etc. — no env gate.
- **GOTCHA**: This is a behavior change visible to existing GUI clients. The GUI's discriminated union already lists the variants (Phase 1) and unhandled variants are ignored, so no UI breakage. Note in PR description.
- **VALIDATE**: typecheck; manual: drag a 3-node-graph task to `doing`, observe `node_started` / `node_finished` in browser DevTools WS messages.

### Task 12 (optional): Add `nodeId` to existing `agent_log`/`agent_text`/`agent_tool_call` payloads
- **ACTION**: Edit `core/src/types/index.ts`, `gui/src/types/index.ts`, `core/src/services/wsService.ts`, and graphRunner's `runClaude` callback wiring.
- **IMPLEMENT**:
  - Extend the three WS variants with optional `nodeId?: string` on payload.
  - In graphRunner, when calling `broadcastLog`, `broadcastAgentText`, `broadcastToolCall`, pass the current `nodeId`. Existing helpers accept the extra field via spread.
- **MIRROR**: existing helper signatures.
- **GOTCHA**: Existing executor (legacy path) doesn't pass `nodeId`; consumers must treat it as optional. GUI ignores undefined fields.
- **VALIDATE**: typecheck both; drag a graph task, confirm WS events carry `nodeId` per-node; legacy task still works without `nodeId`.

### Task 13: Documentation — recommended starter agents
- **ACTION**: Append to `.claude/PRPs/reports/graph-runner-mvp-report.md` (created in implement phase) a "Recommended starter agents" section with example `.claude/agents/planner.md`, `coder.md`, `reviewer.md` content, plus an example 3-node `_graph.json`. Users copy-paste to bootstrap.
- **VALIDATE**: Manual readthrough.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `planGraph` empty graph | `{ nodes: [], edges: [] }` | throws `GraphValidationError("no_nodes")` | Yes |
| `planGraph` single node | one node, no edges | `{ order: [n1], slugById: {n1: 'planner'} }` | Yes |
| `planGraph` 3-node chain | a→b→c | `order: [a, b, c]` | No |
| `planGraph` two entries | a, b (both with no incoming) | throws `multiple_entries` | Yes |
| `planGraph` cycle a→b→a | | throws `cycle` | Yes |
| `planGraph` branching a→b, a→c | | throws `branching` | Yes |
| `planGraph` disconnected | a→b, c | throws `missing_slug` | Yes |
| `buildNodePrompt` no prior | agent + task | string contains agent body + task brief, no diff section | Yes |
| `buildNodePrompt` with prior diff | prior with 50k char diff | diff truncated at 30k | Yes |
| `loadAgentDefinition` missing file | non-existent slug | returns `null` | Yes |
| `loadAgentDefinition` allowedTools CSV | `allowedTools: "Read, Write, Bash"` | `allowedTools: ["Read", "Write", "Bash"]` | No |

### Integration / Manual Tests
| Scenario | Expected |
|---|---|
| Project with no `_graph.json` | Legacy path; one `legacy:coder` row | 
| Project with `_graph.json` containing 1 node | Legacy path (≥2 threshold) |
| Project with 3-node linear graph (planner→coder→reviewer) | 3 per-node rows; PR opens after reviewer |
| Abort during coder node | Coder row `status='aborted'`, reviewer row never created, task rolls back to `todo` |
| `_graph.json` missing agent file (`.claude/agents/planner.md` doesn't exist) | Run errors with "Agent file missing for node ... (.claude/agents/planner.md)"; task rolls back |
| Cyclic graph | Run errors `Graph validation failed: cycle`; task rolls back |
| Per-node `model` set in frontmatter | `task_node_runs.model` reflects it |

### Edge Cases Checklist
- [x] Empty `_graph.json` (only `{}`) — graph schema parse fails → `loadGraph` returns null → legacy path
- [x] Disconnected node — `missing_slug` error
- [x] Self-cycle — `cycle` error
- [x] Two entries — `multiple_entries` error
- [x] Concurrent task on same project — slot lock from executor handles it (graphRunner inherits)
- [ ] Concurrent comment runner during graph run — comment runner queues behind in-flight executor (existing behavior, untested)

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
EXPECT: existing 36 tests + new graphRunner tests (~12+) all green.

### Build
```bash
cd core && npm run build
```
EXPECT: clean.

### Database / Schema
No schema changes (Phase 1 already shipped `task_node_runs`).

### Manual Validation (3-node graph end-to-end)
- [ ] Author `.claude/agents/planner.md`, `coder.md`, `reviewer.md` in a test repo
- [ ] Author `.claude/agents/_graph.json` connecting them linearly
- [ ] Create a task in that project, drag `todo → doing`
- [ ] Watch live: `agent_log` events appear (later: tagged with `nodeId`)
- [ ] After completion: `sqlite3 core/data/tasks.db "SELECT nodeId, nodeType, status, inputTokens, model FROM task_node_runs WHERE taskId='<id>' ORDER BY startedAt;"` → 3 rows
- [ ] PR opens with reviewer's commentary in body
- [ ] Abort midway: `task_node_runs` shows the in-flight node as `aborted`, downstream nodes never inserted
- [ ] Same task on a project with empty `_graph.json` → still 1 `legacy:coder` row, identical to Phase 1 behavior

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] graphRunner unit tests written and passing
- [ ] Legacy single-node tasks still work byte-for-byte (regression test: same task before/after Phase 2 produces equivalent PR)
- [ ] 3-node graph task produces 3 `task_node_runs` rows, no `legacy:coder` row
- [ ] No type errors, no lint errors

## Completion Checklist
- [ ] Code follows discovered patterns (parseAgentFile, runClaude callbacks, NodeRun lifecycle, abort semantics)
- [ ] Error handling matches codebase style (`errorMessage`, console.error for non-fatal, throw for fatal)
- [ ] Tests follow self-cleaning pattern (afterAll deletes fixture project/task)
- [ ] No hardcoded values (default tools list lives in graphRunner.ts as a single const)
- [ ] No unnecessary scope additions (CI node, fix loop, dashboard all explicitly deferred)
- [ ] Self-contained — implementer doesn't have to re-search for graph storage path, runClaude shape, or NodeRun fields

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Per-node prompts use 3× more tokens than monolithic | M | M (cost) | Phase 5 Cost Guardrails address this; Phase 2 ships with telemetry only |
| Diff truncation at 30k loses critical context for reviewer | M | M | Reviewer prompt instructs the agent to ask for full diff via Bash if truncated; Phase 4 may add structured summarization |
| Agent frontmatter `allowedTools` mistype gives the agent wrong toolset | M | H (security) | Validate tool names against a known set on parse; reject unknown tools with a clear error |
| Linear-only constraint feels arbitrary to power users | L | L | Document the limitation; Phase 4 introduces cyclic edges for the CI fix loop |
| Graph runner failure mid-chain leaves partial work in repo | H | M | Same behavior as legacy: rollback to `todo`, leave branch with partial commits; user retries |
| `RUNNING` map collision (legacy still owns the AbortController) | L | H | Reuse the existing controller; graphRunner shares it via parameter — no second registration |
| Comment runner racing with graph runner on same branch | L | M | Existing slot lock already serializes; document explicitly |
| Topology sync to `CLAUDE.md` becomes stale once graph runs differently | L | L | Phase 3 may rewrite topology sync; for now `claudeTopologySyncService` keeps writing the old format |

## Notes

- This phase intentionally keeps the legacy path alive — projects without `_graph.json` (or with single-node graphs) keep working exactly as Phase 1. Migration is opt-in: a user creates a real graph and the next task run flips to graphRunner automatically.
- `nodeType` mapping is a heuristic on slug for v2. A future refinement adds an explicit `type:` frontmatter field so users can name their slug whatever they want and still get accurate categorization (powers the Phase 6 dashboard).
- The 30k diff truncation is conservative; Sonnet's effective context for diffs-as-code-review is much larger, but other content (agent body, task brief, project background) competes for the same window. Tune if reviewer agents complain.
- "Single working tree" decision keeps comment-runner compatible — it checks out the task's branch, applies the comment via `claude`, commits, pushes. Per-node worktrees would break this; PRD Open Question #3 acknowledges this trade-off.
- Removing the `bypassPermissions` security smell is **not** done here. Per-node `allowedTools` makes it possible (each agent declares exactly what it needs), but actually flipping the default requires every existing agent file to declare tools — that's a separate cleanup PR.
- After this lands, "Phase 2 complete" means: a user with three real `.claude/agents/*.md` files and a 3-node graph can drop a card and get a PR back, with cost+timing telemetry per node visible in the database (not yet in the UI — that's Phase 6).
