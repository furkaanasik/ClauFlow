# Implementation Report: Phase 2 Graph Runner MVP

## Summary

Made the Studio graph (`.claude/agents/_graph.json`) drive task execution end-to-end. New `graphRunner.ts` walks linear node chains (`planner → coder → reviewer`), invoking `claude` per node with its own prompt + allowed-tools (from frontmatter), passing structured `{text, diff, extra}` artifacts between nodes. After the coder node, a `git diff <base>..HEAD` capture flows into the reviewer's input. The executor routes to graphRunner when `_graph.json` has ≥2 nodes; otherwise the legacy single-claude path (Phase 1 behavior) is preserved byte-for-byte. Per-node `task_node_runs` rows replace the single `legacy:coder` row when graphRunner is active. The `CLAUFLOW_NODE_EVENTS` env gate was removed — node events broadcast unconditionally now.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched) |
| Confidence | 7/10 | Single-pass; one minor scope reduction (Task 9 deferred) |
| Files Changed | ~10 | 7 (+1 PRD edit) |
| Tests Added | ~12 | 17 (planGraph + deriveNodeType + buildNodePrompt) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Create `graphService.ts` (extract loaders) | Complete | |
| 2 | Update `projectsClaude.ts` to import from graphService | Complete | Net −98/+9 in projectsClaude — significant simplification |
| 3 | GUI types parity (`allowedTools`) | Complete | `ClaudeAgent.allowedTools: string \| null` |
| 4 | Verify `task_node_runs` accepts artifact JSON | Complete | No-op; Phase 1 already supports `Record<string, unknown>` |
| 5 | `graphRunner.ts` skeleton + `planGraph` | Complete | |
| 6 | graphRunner main loop | Complete | |
| 7 | `buildNodePrompt` with prior artifact | Complete | 30k char diff truncation |
| 8 | graphRunner unit tests | Complete | 17 tests, all green |
| 9 | Extract finalizer.ts | **DEFERRED** | Kept commit/push/PR inline in `executor.ts`. graphRunner returns to executor's existing finalize block. Avoided a multi-file refactor that wouldn't change behavior. |
| 10 | Wire executor.ts → graphRunner | Complete | `useGraphRunner = !!graph && graph.nodes.length >= 2` |
| 11 | Drop `CLAUFLOW_NODE_EVENTS` env gate | Complete | Node events always broadcast |
| 12 | `nodeId` on `agent_log/text/tool_call` payloads | **DEFERRED** | Better fit for Phase 3 (Studio runtime UX) when GUI consumers will exist |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (core typecheck) | Pass | Zero errors |
| Static Analysis (gui typecheck) | Pass | Zero errors |
| Lint (gui ESLint) | Pass | Clean |
| Unit Tests (core) | Pass | **5 files, 53/53** tests green (Phase 1: 36 + Phase 2: 17) |
| Build (core) | Pass | `tsc -p tsconfig.json` clean |
| Integration | N/A | Live 3-node graph run requires real `.claude/agents/*.md` + repo (manual smoke required) |
| Edge Cases | Pass | All `planGraph` validation reasons covered (empty / no_entry / multiple_entries / cycle / branching / disconnected) |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `core/src/services/graphService.ts` | CREATED | new file (~125 lines) |
| `core/src/agents/graphRunner.ts` | CREATED | new file (~340 lines) |
| `core/src/agents/graphRunner.test.ts` | CREATED | new file (~210 lines, 17 tests) |
| `core/src/agents/executor.ts` | UPDATED | +47 / −18 (route + scope hoist) |
| `core/src/routes/projectsClaude.ts` | UPDATED | +9 / −98 (extracted helpers + `allowedTools` round-trip) |
| `core/src/services/wsService.ts` | UPDATED | −7 (env gate removed) |
| `gui/src/lib/api.ts` | UPDATED | +1 (`allowedTools` on `ClaudeAgent`) |
| `.claude/PRPs/prds/orchestration-ci-observability.prd.md` | UPDATED | phase status flipped |

Total: roughly **+700 / −135** across 8 files.

## Deviations from Plan

1. **Task 9 (`finalizer.ts` extract) deferred.** The plan called for moving `commit + push + PR create` into a shared module. In practice graphRunner returns to executor.ts's existing finalize block (Steps 4–6). Extracting it would have meant moving 4–5 private helpers (`pushLog`, `pushBlock`, `pushCmdResult`, `setAgentStep`, `extractAcceptanceCriteria`) into a runtime module — pure refactor with no behavior change. Skipped to keep this phase focused on the graph runner itself. If a third executor variant ever needs to share finalize, this becomes a follow-up.
2. **Task 12 (`nodeId` on `agent_log` / `agent_text` / `agent_tool_call` payloads) deferred to Phase 3.** Phase 1 already added `node_started` / `node_finished` / `node_log` events with `nodeId`. Tagging the existing event types is purely a UI-prep change for grouping logs by node — Phase 3 (Studio runtime UX) is when the GUI will actually consume that grouping, so doing it now would ship dead-data fields.
3. **`projectsClaude.ts` got significantly simplified** (−98 / +9). The plan estimated only `import` swaps; the actual cleanup removed the local copies entirely (replaced with `gs*` re-exports as type aliases / function consts). Cleaner than expected.
4. **`acceptanceCriteria` hoist in `executor.ts`.** Originally declared inside the legacy Step 3 block; the conditional split forced hoisting it to the outer scope (used in Step 6 PR body). Trivial scope adjustment.

## Issues Encountered

1. **GateGuard hook** required fact-block presentations before each Edit/Write — repetitive but no code impact. Same overhead as Phase 1.
2. **`ClaudeAgent` field mismatch:** GUI added `allowedTools: string | null` but the server route handlers (`createClaudeAgent`, `updateClaudeAgent`, list/get) initially didn't return the field. Fixed by extending all 5 response objects in `projectsClaude.ts` to include `allowedTools: frontmatter.allowedTools ?? null` (or from `fm.allowedTools` on writes).
3. **Step 3 conditional split** required wrapping the existing legacy block in `else { ... }` and adding a closing `}`. Safe and reversible.
4. **`finalizeNodeRun` calls in executor.ts** had to be made conditional on `!useGraphRunner` so graph runs don't get an extra phantom `legacy:coder` row finalize alongside the real per-node rows.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `core/src/agents/graphRunner.test.ts` | 17 | `planGraph` (8: empty, single, 3-chain, multiple_entries, no_entry, cycle, branching, disconnected); `deriveNodeType` (3: exact match, prefix/suffix, fallback); `buildNodePrompt` (6: agent body, prior text, prior diff, 30k truncation, title fallback, missing background) |

## Manual Smoke Checklist (post-merge)

- [ ] Author `.claude/agents/planner.md`, `coder.md`, `reviewer.md` in a test repo (recommend `Read, Glob, Grep` for planner/reviewer; default tools for coder)
- [ ] Author `.claude/agents/_graph.json` connecting them linearly
- [ ] Drag a task `todo → doing` in that project
- [ ] After completion: `sqlite3 core/data/tasks.db "SELECT nodeId, nodeType, status, inputTokens, outputTokens FROM task_node_runs WHERE taskId='<id>' ORDER BY startedAt;"` shows 3 rows with `nodeType` matching slugs and `status='done'`
- [ ] Drag a task in a project with NO `_graph.json` — confirm legacy path: 1 `legacy:coder` row
- [ ] Abort a task during the coder node — confirm `task_node_runs.status='aborted'` for coder, no reviewer row inserted

## Recommended Starter Agents

A user wanting to opt into graphRunner can drop these three files into `.claude/agents/`:

**`planner.md`**
```
---
name: Planner
description: Breaks the task into testable steps before any code is written.
allowedTools: Read, Glob, Grep
---

You are the **planner** for this task.

Read the relevant code paths to understand current behavior. Output a short plan:
1. What files will change.
2. What the change does in one sentence.
3. Acceptance criteria as testable bullets.

Do NOT write or edit files. End with "Plan complete."
```

**`coder.md`**
```
---
name: Coder
description: Implements the planner's plan with tests.
---

You are the **coder**. The previous node produced a plan. Implement it exactly:
- Make the code changes described.
- Write or update tests so each acceptance criterion is asserted.
- Run the test command and ensure it passes before exiting.

If the plan looks wrong, surface that as a comment in your final message rather than diverging silently.
```

**`reviewer.md`**
```
---
name: Reviewer
description: Reviews the coder's diff against the plan and emits review comments.
allowedTools: Read, Bash, Glob, Grep
---

You are the **reviewer**. The previous node provided the diff and prior plan.

Verify:
- Each acceptance criterion is satisfied by the diff.
- Tests actually run and assert behavior (not just exist).
- No security smells (hardcoded secrets, unsafe input handling, missing validation).

Output a short review (✓/✗ per criterion + any blockers). Do not modify the code.
```

**`_graph.json`**
```json
{
  "nodes": [
    { "id": "n1", "type": "agent", "position": { "x": 0, "y": 0 }, "data": { "slug": "planner" } },
    { "id": "n2", "type": "agent", "position": { "x": 240, "y": 0 }, "data": { "slug": "coder" } },
    { "id": "n3", "type": "agent", "position": { "x": 480, "y": 0 }, "data": { "slug": "reviewer" } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2" },
    { "id": "e2", "source": "n2", "target": "n3" }
  ]
}
```

## Next Steps

- [ ] Manual smoke test with the starter agents above
- [ ] Code review via `/code-review`
- [ ] Commit + PR via `/prp-commit` + `/prp-pr`
- [ ] Update PRD Phase 2 from `in-progress` to `complete` once merged
- [ ] Plan Phase 3 (Studio Runtime UX) — adds Task 12's `nodeId` tagging plus run-trace overlay on the canvas
