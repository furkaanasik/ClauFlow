# Plan: Phase 4 — CI Gate + Fix Loop (Bet 2)

## Summary

Insert a real CI quality gate between `doing` and `review`. After the executor pushes a feature branch and opens a PR, the task moves to a new `ci` kanban column instead of straight to `review`. A backend `ciWatcher` polls `gh pr checks <prNumber> --json` until the PR's checks resolve. On green, the task auto-promotes to `review`. On red, a `fixer` graph node reads structured failure context (failing job names + tail of failing log), runs `claude` with that context as the prior artifact, commits + pushes — which triggers a new CI run. A hard iteration cap (default 3) is enforced; on exhaustion the task escalates to `review` with `agent.error` set and the full failure history preserved in `task_node_runs`.

## User Story

As a **ClauFlow user running tasks unattended**, I want **CI failures to auto-trigger a claude fix attempt before the PR lands in my review queue**, so that **I only see PRs whose checks are actually green, and tasks that genuinely need my judgment surface with full failure context instead of buried in a giant log.**

## Problem → Solution

**Current state**: After `executor.ts` pushes and opens a PR (`executor.ts:497`), the task transitions directly to `review` regardless of CI status (`executor.ts:518`). A user dragging into review must manually open the PR on GitHub to see if checks passed; failed checks require either manual fix or a Comment that re-runs claude. There is no automatic CI→fix loop.

**Desired state**: After `executor.ts` opens the PR, the task transitions to a new `ci` status. A `ciWatcher` service polls `gh pr checks --json` every ~15s. On `pass`, task → `review`. On `fail`, `ciWatcher` builds a structured failure artifact (`{ failures: [{ job, conclusion, logTail }] }`), spawns a `fixer` node via `graphRunner` machinery (re-checks out the feature branch, runs claude with the failure as input, commits + pushes), increments `ciIteration`, and resumes polling. After `maxFixIterations` (default 3) consecutive red runs, task → `review` with `agent.status="error"` and a clear escalation message.

## Metadata
- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/orchestration-ci-observability.prd.md](../prds/orchestration-ci-observability.prd.md)
- **PRD Phase**: Phase 4 — CI Gate + Fix Loop (Bet 2)
- **Estimated Files**: ~14 (4 new, 10 edits) · ~700–900 LOC
- **Depends on**: Phase 1 (task_node_runs, WS events), Phase 2 (graphRunner)
- **Parallel with**: Phase 3 (Studio Runtime UX)

---

## UX Design

### Before
```
todo → doing → [PR pushed] → review → done
                                         (drag, gh pr merge)
```

### After
```
todo → doing → [PR pushed] → ci ──(green)──► review → done
                              │
                              └─(red, iter < 3)─► fixer node ──► commit+push ──► ci (iter+1)
                              │
                              └─(red, iter == 3)─► review (agent.status=error)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Kanban columns | `todo · doing · review · done` (4) | `todo · doing · ci · review · done` (5) | New status between `doing` and `review` |
| `ALLOWED_TRANSITIONS` (Board.tsx:35) | `doing→[]`, `review→["done"]` | `doing→[]`, `ci→["review"]` (manual override), `review→["done"]` | User can manually skip CI when desired |
| Status after PR open | `review` | `ci` if remote + project has CI configured/detected; else `review` (preserves no-remote and no-CI projects) | Backwards compat |
| WS events | `node_started/finished/log` | + `ci_check_status`, `ci_iteration_started`, `ci_iteration_result` | Additive, typed in WsMessage union |
| `task_node_runs` rows | planner/coder/reviewer/legacy | + rows with `nodeType="ci"` (one per poll cycle that produced a verdict) and `nodeType="fix"` (one per fix attempt), populated `ciIteration` | Column already exists from Phase 1 |
| TaskDetailDrawer | Single agent log | Same log; CI/fix runs interleaved with `▸ CI iteration 2/3` markers | No new UI surface in this phase — log lines suffice |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/agents/executor.ts` | 470–531 | The PR-create + final-status-set block — exact insertion point for `ci` transition |
| P0 | `core/src/agents/executor.ts` | 38–82 | `ACTIVE`, `acquireSlot`, `RUNNING` map, `abort`, `waitForIdle`, `enqueue` — fix-loop must integrate with these |
| P0 | `core/src/agents/graphRunner.ts` | 170–389 | `runGraph` body — pattern for invoking claude with prior artifact and writing per-node rows. Fixer reuses the same primitives. |
| P0 | `core/src/types/index.ts` | 1, 91–157 | `TaskStatus` enum (extend with `"ci"`), `NodeType` already includes `"ci"`/`"fix"` (from Phase 1), `WsMessage` union (extend) |
| P0 | `core/src/services/gitService.ts` | all | `run()`, `checkoutBase`, `commitAll`, `pushBranch` — fix loop needs identical git ops |
| P0 | `core/src/services/taskService.ts` | 109–127, 209–268 | `task_node_runs` table shape (`ciIteration` column already present); idempotent migration pattern |
| P0 | `core/src/routes/tasks.ts` | 130–203 | The PATCH handler — `done` transition merges PR; `ci → review` manual transition needs same care |
| P0 | `gui/src/components/Board/Board.tsx` | 27–40, 96–113, 287–298 | `COLUMN_STATUSES`, `COLUMN_NUMERALS`, `ALLOWED_TRANSITIONS`, `byStatus` initializer — every literal that hardcodes the 4 statuses |
| P0 | `gui/src/components/Board/BoardColumn.tsx` | 18–23 | `COLUMN_TONE` map — needs a `ci` entry |
| P1 | `gui/src/types/index.ts` | 1 | Mirror of `TaskStatus` — must stay in sync with core |
| P1 | `gui/src/lib/i18n/en.ts` | 235–246, 375 | `board.columns`, `board.emptyStates` — both need a `ci` entry; same in `tr.ts` |
| P1 | `core/src/services/wsService.ts` | 148+ | `broadcastNode*` helpers — pattern for the new ci broadcasters |
| P1 | `core/src/agents/graphRunner.ts` | 130–163 | `buildNodePrompt` — fixer prompt builder mirrors the `prior` block |
| P2 | `.claude/PRPs/plans/completed/graph-runner-mvp.plan.md` | all | Reference for plan style and validation rigor |

## External Documentation

- `gh pr checks --help` — `--json` flag returns `[{ name, state, conclusion, link, completedAt, ... }]` where `state` ∈ `{IN_PROGRESS, COMPLETED, QUEUED, ...}` and `conclusion` ∈ `{SUCCESS, FAILURE, CANCELLED, SKIPPED, ...}`. Source of truth — do not invent webhook infra.
- `gh run view <run-id> --log-failed` — fetches the failed-step log lines for a given workflow run; we use it (or `gh run view --log` with grep) to capture log tails for the failure artifact.
- Context7 / vendor docs are NOT needed here; everything routes through `gh` CLI.

---

## Patterns to Mirror

### CI_POLL_LOOP
```ts
// SOURCE: core/src/agents/executor.ts:42-55 (acquireSlot polling pattern)
async function pollPrChecks(
  repoPath: string,
  prNumber: number,
  signal: AbortSignal,
): Promise<CiVerdict> {
  for (let i = 0; i < CI_POLL_MAX_ITERS; i++) {
    if (signal.aborted) throw new Error("aborted");
    const r = await gitRun("gh", ["pr", "checks", String(prNumber), "--json", "name,state,conclusion,link"], repoPath);
    if (r.code !== 0) {
      // Treat transient gh errors as "still pending" up to N consecutive failures.
      continue;
    }
    const verdict = parseChecksJson(r.stdout);
    if (verdict.kind !== "pending") return verdict;
    await new Promise((res) => setTimeout(res, CI_POLL_INTERVAL_MS));
  }
  return { kind: "timeout" };
}
```
Mirrors the structural shape of `acquireSlot` (poll + sleep + cap). Use `AbortSignal` (not the executor's `RUNNING` map directly) so `abort(taskId)` cascades cleanly.

### FIX_NODE_INVOCATION
```ts
// SOURCE: core/src/agents/graphRunner.ts:200-330 (per-node claude invocation pattern)
const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;
insertNodeRun({
  id: nodeRunId,
  taskId,
  nodeId: `fixer:iter-${iteration}`,
  nodeType: "fix",
  status: "running",
  startedAt: new Date().toISOString(),
  ciIteration: iteration,
  inputArtifact: { failures: failureArtifact, extra: {} },
  model: agent?.frontmatter.model ?? null,
});
broadcastNodeStarted(...);

const prompt = buildFixerPrompt(task, project, failureArtifact, agent);
const result = await runClaude({
  prompt,
  cwd: project.repoPath,
  allowedTools: agent?.allowedTools ?? DEFAULT_TOOLS,
  signal: controller.signal,
  outputFormat: "stream-json",
  onLine, onText, onToolCallStart, onToolCallEnd, onResult,
});
// then: commitAll → pushBranch (no new PR — pushes to existing branch)
```
Reuse `runClaude` callbacks identically — text/tool-call telemetry must keep working inside the fix loop.

### STATUS_TRANSITION_BROADCAST
```ts
// SOURCE: core/src/agents/executor.ts:519-531
const final = await updateTask(task.id, {
  status: hasRemote && ciEnabled ? "ci" : (hasRemote ? "review" : "done"),
  prUrl, prNumber,
  agent: { status: "done", currentStep: "ci_pending", finishedAt: new Date().toISOString() },
});
broadcastStatus(task.id, "done", "ci_pending");
broadcastTaskUpdated(final);
```
Always pair `updateTask` with the matching `broadcast*` calls — silent DB mutations leave the GUI stale.

### IDEMPOTENT_MIGRATION
```ts
// SOURCE: core/src/services/taskService.ts:209-262
// Phase 4 needs no schema migration — `task_node_runs.ciIteration` already exists.
// If we add `tasks.ciIterations INTEGER` (current count for the live row), follow this pattern verbatim.
```

---

## Files to Change

### New (4)
| Path | Purpose | Approx LOC |
|---|---|---|
| `core/src/agents/ciWatcher.ts` | Polls `gh pr checks` per task; orchestrates fix loop; writes ci/fix `task_node_runs`; broadcasts CI events | ~250 |
| `core/src/services/ciService.ts` | Pure functions: `parseChecksJson`, `fetchFailedLogs`, `buildFailureArtifact`. No side effects beyond shelling `gh`. | ~180 |
| `core/src/agents/ciWatcher.test.ts` | Vitest: `parseChecksJson` cases (all-success, mixed, in-progress, malformed), `buildFailureArtifact` truncation | ~150 |
| `gui/src/components/Card/CiBadge.tsx` | Tiny status pill on `TaskCard` for tasks in `ci` (iter X/3, last conclusion) | ~50 |

### Edit (10)
| Path | Change |
|---|---|
| `core/src/types/index.ts` | Extend `TaskStatus` to include `"ci"`. Extend `WsMessage` union with `ci_check_status`, `ci_iteration_started`, `ci_iteration_result`. Add `CiVerdict`, `CiFailure`, `CiFailureArtifact` interfaces. |
| `core/src/services/wsService.ts` | Add `broadcastCiCheckStatus`, `broadcastCiIterationStarted`, `broadcastCiIterationResult`. |
| `core/src/services/taskService.ts` | (Optional, only if we want a quick `tasks.ciIterations` denormalized count) — add column via idempotent ALTER. Otherwise derive from `task_node_runs`. **Default: derive, no schema change.** |
| `core/src/agents/executor.ts` | After `gh pr create` succeeds, set `status="ci"` (when CI is enabled for the project) and call `ciWatcher.start(task, project, prNumber, controller)`. Move final `status="done"`/`"review"` flip into ciWatcher's `onGreen`/`onExhausted` paths. Update the `nothingToCommit && commitsAhead===0` short-circuit to skip CI (still goes to `done`). |
| `core/src/routes/tasks.ts` | Validate that `ci → review` is a legal manual override (user "force-passes" the gate). When transitioning out of `ci`, call `ciWatcher.stop(taskId)` so the poller doesn't keep firing. |
| `gui/src/types/index.ts` | Mirror `TaskStatus` change. |
| `gui/src/components/Board/Board.tsx` | Add `"ci"` to `COLUMN_STATUSES`, `COLUMN_NUMERALS` (`"03"` becomes ci, review→`"04"`, done→`"05"`), `ALLOWED_TRANSITIONS` (`ci: ["review"]`), `byStatus` initializer, grid layout (`xl:grid-cols-5`). |
| `gui/src/components/Board/BoardColumn.tsx` | Add `ci` entry to `COLUMN_TONE`. Add `hasActiveCi` indicator (animate dot when any task in column is mid-fix). |
| `gui/src/lib/i18n/en.ts` + `tr.ts` | Add `ci` to `board.columns` and `board.emptyStates`. EN: `"CI"` / `"Awaiting checks"`. TR: `"CI"` / `"Kontroller bekleniyor"`. |
| `gui/src/components/Card/TaskCard.tsx` | When `task.status === "ci"`, render `<CiBadge />` showing iteration progress. |

### NOT Changing
- `core/src/agents/commentRunner.ts` — comments on `ci`-state tasks queue behind ciWatcher; no behavior change in this phase. (Document the queue assumption in code comment.)
- `gh pr merge` flow in `tasks.ts` — `ci → done` is NOT a legal direct drag (must pass `review` first).
- Studio canvas (`gui/src/components/Studio/`) — `ci` and `fix` are *implicit* nodes for now, not user-authorable. Future phase exposes them.

---

## NOT Building

- **Per-node CI configuration UI** — no Studio editor for fixer prompts. The fixer node loads `.claude/agents/fixer.md` if it exists; falls back to a hardcoded built-in prompt.
- **Custom CI commands** (Phase 4 PRD bullet "explicit `ci.command` override in project settings") — out of scope for this iteration. We rely entirely on `gh pr checks`. Custom commands lifted to a follow-on if `gh` proves insufficient.
- **Per-failing-job parallel fix attempts** — fixer sees all failures in one prompt, attempts one consolidated fix per iteration.
- **Per-task budget integration** (Phase 5 territory) — fix loop respects only the iteration cap, not USD cost.
- **Cyclic graph edges in Studio** — the `ci ↔ fix` cycle lives in code, not in `_graph.json`. Phase 4 does not extend `planGraph()` to permit cycles.
- **Webhook-based CI status** — polling only.
- **Multi-PR / per-commit checks** — only PR-level checks via `gh pr checks <prNumber>`.

---

## Step-by-Step Tasks

> Each task is executable + validatable in isolation. Run `cd core && npm run typecheck` after every backend task; `cd gui && pnpm typecheck && pnpm lint` after every frontend task.

### Task 1 — Extend `TaskStatus` enum and WS union (core + gui)

- **ACTION**: Add `"ci"` to `TaskStatus`. Add three new variants to `WsMessage`. Define new shared interfaces.
- **IMPLEMENT**:
  ```ts
  // core/src/types/index.ts:1
  export type TaskStatus = "todo" | "doing" | "ci" | "review" | "done";

  // core/src/types/index.ts (append)
  export interface CiFailure {
    jobName: string;
    conclusion: "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED";
    link: string | null;
    logTail: string | null; // up to 4000 chars, may be null if fetch failed
  }

  export interface CiFailureArtifact {
    prNumber: number;
    iteration: number;
    failures: CiFailure[];
    capturedAt: string;
  }

  export type CiVerdict =
    | { kind: "pending" }
    | { kind: "pass" }
    | { kind: "fail"; failures: CiFailure[] }
    | { kind: "no_checks" }   // PR has zero checks → treat as pass (skip CI gate)
    | { kind: "timeout" };

  // Extend WsMessage union
  | { type: "ci_check_status"; taskId: string; payload: { prNumber: number; verdict: CiVerdict } }
  | { type: "ci_iteration_started"; taskId: string; payload: { iteration: number; maxIterations: number } }
  | { type: "ci_iteration_result"; taskId: string; payload: { iteration: number; outcome: "pass" | "fail" | "exhausted" } }
  ```
- **MIRROR**: `gui/src/types/index.ts:1` — keep type identical to core (string copy).
- **IMPORTS**: none new.
- **GOTCHA**: GUI `WsMessage` union may live in `gui/src/types/index.ts` — verify and mirror. The hook `useAgentSocket` may have an exhaustive switch; add no-op cases or it will type-error.
- **VALIDATE**: `cd core && npm run typecheck && cd ../gui && pnpm typecheck`.

### Task 2 — `ciService.ts`: pure parsing + log capture

- **ACTION**: Create `core/src/services/ciService.ts` with three pure-ish functions: `parseChecksJson(raw: string): CiVerdict`, `fetchFailedLogs(repoPath, runIds): Promise<Record<string, string>>`, `buildFailureArtifact(prNumber, iteration, verdict, logsByJob): CiFailureArtifact`.
- **IMPLEMENT**:
  - `parseChecksJson`: `JSON.parse` + zod-validate; map states. If any check has `state !== "COMPLETED"` → `pending`. If all `conclusion === "SUCCESS" | "SKIPPED" | "NEUTRAL"` → `pass`. If any `conclusion ∈ {FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED}` → `fail` with mapped `CiFailure[]` (logTail=null at this stage).
  - `fetchFailedLogs`: derive run IDs from check `link` URLs (e.g. `.../actions/runs/<id>/job/<jobid>`). Call `gh run view <id> --log-failed` per unique run. Tail to 4000 chars. Skip silently on non-zero exit.
  - `buildFailureArtifact`: combine.
- **MIRROR**: zod-validation pattern from `core/src/routes/projectsClaude.ts` graph schema.
- **IMPORTS**: `import { run as gitRun } from "./gitService.js"; import { z } from "zod"; import type { CiFailure, CiVerdict, CiFailureArtifact } from "../types/index.js";`
- **GOTCHA**: `gh pr checks --json name,state,conclusion,link` may return `[]` — handle the no-checks case explicitly (return `{kind:"no_checks"}`), don't treat as `pass` silently. Differentiate downstream in ciWatcher.
- **VALIDATE**: Run unit test (Task 3).

### Task 3 — `ciWatcher.test.ts`: parser unit tests

- **ACTION**: Cover `parseChecksJson` with: all-success, mixed-success-and-skipped, one-failure, multiple-failures, all-pending, malformed JSON, empty array. Cover `buildFailureArtifact` log truncation.
- **IMPLEMENT**: Vitest, AAA structure. Mirror `core/src/services/taskService.nodeRuns.test.ts` import pattern.
- **MIRROR**: `core/src/services/pricingService.test.ts` for pure-function test layout.
- **IMPORTS**: `import { describe, it, expect } from "vitest"; import { parseChecksJson, buildFailureArtifact } from "./ciService.js";`
- **GOTCHA**: Don't actually shell out to `gh` in tests — `fetchFailedLogs` must accept an injected `runner` for testing OR be tested at integration level.
- **VALIDATE**: `cd core && npx vitest run src/services/ciService` — all green.

### Task 4 — `ciWatcher.ts`: poll loop + fix invocation skeleton

- **ACTION**: Create `core/src/agents/ciWatcher.ts`. Exports `start(task, project, prNumber, controller)`, `stop(taskId)`, `isWatching(taskId)`. Internal: `WATCHERS = new Map<string, AbortController>()` mirroring executor's `RUNNING`. The `controller` passed in is the executor's; we register a child controller so `abort(taskId)` cascades.
- **IMPLEMENT**:
  ```ts
  const CI_POLL_INTERVAL_MS = Number(process.env.CLAUFLOW_CI_POLL_MS ?? 15_000);
  const CI_POLL_MAX_ITERS = Number(process.env.CLAUFLOW_CI_POLL_MAX ?? 240); // 60min default
  const CI_MAX_FIX_ITERATIONS = Number(process.env.CLAUFLOW_CI_MAX_FIX ?? 3);

  export async function start(task, project, prNumber, parentController): Promise<void> {
    const ctrl = new AbortController();
    parentController.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    WATCHERS.set(task.id, ctrl);
    try {
      let iteration = 0;
      while (iteration <= CI_MAX_FIX_ITERATIONS) {
        const verdict = await pollUntilResolved(project, prNumber, ctrl.signal);
        await recordCiNodeRun(task, iteration, verdict);
        broadcastCiCheckStatus(task.id, prNumber, verdict);
        if (verdict.kind === "pass" || verdict.kind === "no_checks") {
          await transitionToReview(task);
          return;
        }
        if (verdict.kind === "timeout") {
          await escalate(task, "ci timed out");
          return;
        }
        // verdict.kind === "fail"
        if (iteration === CI_MAX_FIX_ITERATIONS) {
          await escalate(task, `CI failed after ${iteration} fix attempts`);
          return;
        }
        iteration += 1;
        broadcastCiIterationStarted(task.id, iteration, CI_MAX_FIX_ITERATIONS);
        await runFixerNode(task, project, prNumber, verdict.failures, iteration, ctrl);
        broadcastCiIterationResult(task.id, iteration, "fail" /* about-to-recheck */);
      }
    } finally {
      WATCHERS.delete(task.id);
    }
  }
  ```
- **MIRROR**: `executor.ts:42-55` (poll-with-cap), `executor.ts:57-67` (controller map + abort).
- **IMPORTS**: `gitService`, `claudeService`, `taskService` (`updateTask`, `insertNodeRun`, `updateNodeRun`), `wsService`, `ciService`.
- **GOTCHA**:
  - Do NOT block the executor's `run()` on the watcher — `executor.ts` calls `ciWatcher.start(...)` fire-and-forget (`.catch(...)`) AFTER PR creation, and itself returns. The watcher owns the task's status from then on.
  - The watcher must remove itself from `WATCHERS` in a `finally` block; otherwise `stop()` and abort cascade leak.
  - When user manually drags `ci → review`, `tasks.ts` PATCH must call `ciWatcher.stop(taskId)`.
- **VALIDATE**: `cd core && npm run typecheck`. Manual smoke test deferred to Task 9.

### Task 5 — Fixer node: prompt + claude run + commit + push

- **ACTION**: Implement `runFixerNode` inside `ciWatcher.ts` (or extract to `core/src/agents/fixerNode.ts` if it crosses ~150 LOC).
- **IMPLEMENT**:
  ```ts
  async function runFixerNode(task, project, prNumber, failures, iteration, controller) {
    const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;
    const agent = loadAgentDefinition(project.repoPath, "fixer"); // optional .claude/agents/fixer.md
    insertNodeRun({
      id: nodeRunId, taskId: task.id, nodeId: `fixer:iter-${iteration}`,
      nodeType: "fix", status: "running", startedAt: new Date().toISOString(),
      ciIteration: iteration, inputArtifact: { failures, extra: {} },
      model: agent?.frontmatter.model ?? null,
    });
    broadcastNodeStarted(...);
    // 1. Re-checkout the feature branch (must be on it; defensive)
    await gitRun("git", ["checkout", task.branch!], project.repoPath);
    // 2. Build prompt: fixer agent body (or default) + structured failure block
    const prompt = buildFixerPrompt(task, project, failures, iteration, agent);
    // 3. runClaude with same callbacks as graphRunner
    const result = await runClaude({ prompt, cwd: project.repoPath, allowedTools: agent?.allowedTools ?? DEFAULT_TOOLS, signal: controller.signal, outputFormat: "stream-json", onLine, onText, onToolCallStart, onToolCallEnd, onResult });
    if (result.code !== 0) { finalizeNodeRunRow(nodeRunId, "error", `claude exit ${result.code}`); throw new Error(...); }
    // 4. commit + push (no new PR — same branch)
    const commit = await commitAll(project.repoPath, `fix(${task.displayId ?? task.id}): ci fix attempt ${iteration}`);
    // tolerate "nothing to commit" — claude may have made no changes; still re-poll
    const push = await pushBranch(project.repoPath, task.branch!);
    if (push.code !== 0) throw new Error("push failed in fixer");
    updateNodeRun(nodeRunId, { status: "done", finishedAt: new Date().toISOString(), outputArtifact: { extra: { commitsAhead: ... } } });
    broadcastNodeFinished(...);
  }
  ```
- **MIRROR**: `graphRunner.ts:200–388` for callback wiring, `executor.ts:411–423` for commit error handling, `executor.ts:454–468` for push.
- **IMPORTS**: `loadAgentDefinition` from `graphService.js`, `runClaude` from `claudeService.js`.
- **GOTCHA**:
  - `commitAll` returning "nothing to commit" + zero new commits = fixer didn't actually change anything → record outcome as `error` with message "fixer made no changes" to break the loop early instead of pushing empty.
  - The feature branch may have moved on remote between iterations — always `git fetch && git checkout <branch>` (use `gitService` helpers).
  - `loadAgentDefinition(repoPath, "fixer")` returns null if file absent — that's fine; provide a hardcoded built-in prompt body.
- **VALIDATE**: `cd core && npm run typecheck`. Integration test deferred.

### Task 6 — `executor.ts` integration

- **ACTION**: After successful `gh pr create` (line 497–514), instead of unconditional `status="review"`, branch on whether CI gating is enabled and start the watcher.
- **IMPLEMENT**:
  ```ts
  // executor.ts, replacing lines 516–531
  const ciEnabled = hasRemote && isCiGateEnabled(project); // helper: true unless project flag opt-out (default true)
  const finalStatus = !hasRemote ? "done" : (ciEnabled ? "ci" : "review");
  const final = await updateTask(task.id, {
    status: finalStatus, prUrl, prNumber,
    agent: { status: "done", currentStep: ciEnabled ? "ci_pending" : "completed", finishedAt: new Date().toISOString() },
  });
  broadcastStatus(task.id, "done", final.agent.currentStep);
  broadcastTaskUpdated(final);
  finalizeNodeRun(nodeRunId, "done");

  if (ciEnabled && prNumber) {
    // fire-and-forget: watcher owns the task from here
    ciWatcher.start(task, project, prNumber, controller).catch((err) => {
      console.error(`[executor] ciWatcher crashed for task ${task.id}:`, err);
    });
  }
  ```
- **MIRROR**: existing fire-and-forget pattern at `core/src/routes/tasks.ts:159–195` (mergePr post-PATCH).
- **IMPORTS**: `import * as ciWatcher from "./ciWatcher.js";`
- **GOTCHA**:
  - The `RUNNING` map currently deletes `task.id` in `executor.ts:557` — but the watcher runs *after* that. So `abort(taskId)` from the GUI will not reach the watcher unless we also wire `WATCHERS.get(taskId)?.abort()`. Update `abort()` in `executor.ts:59–64`:
    ```ts
    export function abort(taskId: string): boolean {
      const ctrl = RUNNING.get(taskId); if (ctrl) { ctrl.abort(); return true; }
      const wctrl = ciWatcher.getController(taskId); if (wctrl) { wctrl.abort(); return true; }
      return false;
    }
    ```
  - `isCiGateEnabled(project)`: phase 4 default = `true` for any project with a remote. Future: per-project setting. Implement as a tiny exported helper that simply returns `hasRemote` for now.
- **VALIDATE**: `cd core && npm run typecheck`. Run the existing executor smoke path.

### Task 7 — Routes: handle `ci → review` manual override

- **ACTION**: In `core/src/routes/tasks.ts` PATCH handler, when `parsed.data.status === "review"` and the existing task is in `ci`, stop the watcher.
- **IMPLEMENT**:
  ```ts
  // tasks.ts:144 area, right after updateTask call
  if (parsed.data.status === "review" && existingTaskBefore?.status === "ci") {
    ciWatcher.stop(req.params.id!);
  }
  ```
- **MIRROR**: existing `parsed.data.status === "done"` branch at `tasks.ts:156`.
- **IMPORTS**: `import * as ciWatcher from "../agents/ciWatcher.js";`
- **GOTCHA**: Need to fetch `existingTask` before update, or pass `oldStatus` through differently. Cleanest: do `const before = await getTask(req.params.id!)` at the top of the handler. The `done`-branch already does similar.
- **VALIDATE**: `cd core && npm run typecheck`. Manual: drag a task in `ci` to `review` and confirm watcher stops via log.

### Task 8 — GUI: column + status wiring

- **ACTION**: Update everything that hardcodes the 4 statuses.
- **IMPLEMENT**:
  - `gui/src/types/index.ts:1`: mirror `TaskStatus` change.
  - `gui/src/components/Board/Board.tsx:27–40`:
    ```ts
    const COLUMN_STATUSES: TaskStatus[] = ["todo", "doing", "ci", "review", "done"];
    const COLUMN_NUMERALS: Record<TaskStatus, string> = {
      todo: "01", doing: "02", ci: "03", review: "04", done: "05",
    };
    const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
      todo: ["doing"], doing: [], ci: ["review"], review: ["done"], done: [],
    };
    ```
  - `Board.tsx:96–113`: extend `byStatus` initializer with `ci: []`. Update the literal in line 146 (`["todo","doing","review","done"]`) to include `"ci"`.
  - `Board.tsx:287`: change `xl:grid-cols-4` → `xl:grid-cols-5`.
  - `BoardColumn.tsx:18–23`: add `ci: { dot: "var(--status-ci, var(--status-review))", ink: "var(--status-ci, var(--status-review))" }`. (Reuse review tone if no CSS var defined yet.)
  - `gui/src/lib/i18n/en.ts:235–246`: add `ci: "CI"` to columns and `ci: { title: "Awaiting checks", hint: "Claude is watching this PR's CI" }` to emptyStates. Same in `tr.ts` with `"CI"` / `"Kontroller bekleniyor"`.
- **MIRROR**: existing `review` entries throughout.
- **IMPORTS**: none new.
- **GOTCHA**:
  - Search the whole `gui/src` tree for any string literal `["todo","doing","review","done"]` or `as TaskStatus` arrays. There are at least two (Board, possibly api.ts query handling). Use ripgrep before declaring done: `rg '"todo".*"doing".*"review".*"done"' gui/src`.
  - The 5-column grid on small screens: `md:grid-cols-2 xl:grid-cols-5` will leave one column orphaned at md. Acceptable; don't over-engineer responsive in this phase.
- **VALIDATE**: `cd gui && pnpm typecheck && pnpm lint && pnpm dev` — eyeball the new column.

### Task 9 — `CiBadge` + TaskCard integration

- **ACTION**: Tiny pill component that, given a task in `ci`, queries node runs to show e.g. "CI · iter 2/3 · failing".
- **IMPLEMENT**:
  - `CiBadge.tsx`: pure presentational. Props: `iteration: number`, `maxIterations: number`, `lastConclusion: "pass"|"fail"|"pending"`. Render with status-tone color.
  - Source the iteration count from the highest `ciIteration` across the task's `task_node_runs` rows. Either fetch via existing `/api/tasks/:id/node-runs` (if Phase 1 exposed one) or via WS `ci_iteration_started` events stored in zustand.
  - `TaskCard.tsx`: when `task.status === "ci"`, render `<CiBadge ... />` in the existing badge row.
- **MIRROR**: `gui/src/components/Card/AgentBadge.tsx` for pill style.
- **IMPORTS**: existing zustand store for live iteration count.
- **GOTCHA**: If Phase 1 did not expose a node-runs endpoint to GUI, the simplest source is WS state — listen for `ci_iteration_started` and store `{taskId → iteration}` in `boardStore`. Don't add a new REST endpoint just for a badge.
- **VALIDATE**: `cd gui && pnpm typecheck && pnpm lint`. Visual smoke-test by manually setting a task to `ci` status in DB.

### Task 10 — Manual end-to-end smoke

- **ACTION**: Set up a benchmark scenario.
- **IMPLEMENT**:
  1. Pick a small repo with a GitHub Actions workflow (e.g. a project running `npm test`).
  2. Create a task whose acceptance criteria can only be met by passing existing tests but whose initial commit will fail one test on purpose (or rely on claude's first attempt to be incomplete).
  3. Drag → `doing`. Watch executor open PR. Confirm task goes to `ci` (not `review`).
  4. Watch ciWatcher: it polls, detects `fail`, logs failure tail, runs fixer, pushes new commit. Iteration counter advances.
  5. Verify exhaustion: artificially break the test so all 3 iterations fail → confirm escalation to `review` with `agent.status="error"`.
- **VALIDATE**: WS log shows the full sequence; `task_node_runs` table contains expected rows (`SELECT id,nodeId,nodeType,status,ciIteration,errorMessage FROM task_node_runs WHERE taskId=?`).

---

## Testing Strategy

| Layer | Coverage | Files |
|---|---|---|
| Unit (pure) | `parseChecksJson` (7+ cases), `buildFailureArtifact` (truncation, empty failures, missing logs), `buildFixerPrompt` (with/without fixer.md, empty failures defensive case) | `core/src/agents/ciWatcher.test.ts`, optional `core/src/services/ciService.test.ts` |
| Integration (with mocked `gh`) | Watcher loop: pass-on-first-poll, fail-then-pass, fail-three-times-then-escalate, abort mid-poll | `core/src/agents/ciWatcher.integration.test.ts` (new, optional but recommended) |
| Manual smoke | Real PR against a real repo (Task 10) | n/a |
| Regression | Existing executor tests + `taskService.nodeRuns.test.ts` still pass | `cd core && npm test` |

Mock `gitRun` via dependency injection in ciWatcher — accept an optional `{ runner = gitRun }` parameter on internal helpers so tests can swap it.

## Validation Commands

Run after each task:

```bash
# Backend
cd core && npm run typecheck
cd core && npx vitest run

# Frontend
cd gui && pnpm typecheck
cd gui && pnpm lint
```

Final gate:

```bash
# Full backend
cd core && npm run build && npm test

# Full frontend
cd gui && pnpm build

# Smoke (manual)
# - Drag task to doing, confirm `ci` column, observe iteration logs
# - Confirm escalation to `review` after 3 failures
# - Confirm manual ci→review override stops the watcher (no further log lines)
```

## Acceptance Criteria

- [ ] `TaskStatus` enum includes `"ci"` in both core and gui; typecheck passes.
- [ ] Kanban board shows 5 columns: `todo · doing · ci · review · done`.
- [ ] Drag rules: `todo→doing`, `ci→review` (manual force-pass), `review→done`. All others rejected with the existing confirmation dialog.
- [ ] After PR creation on a project with a remote, task transitions to `ci` (not `review`) and a `ciWatcher` starts.
- [ ] `parseChecksJson` correctly classifies all known states (unit-tested).
- [ ] On all-green checks, watcher transitions task to `review` and exits cleanly.
- [ ] On fail, watcher writes a `task_node_runs` row with `nodeType="ci"`, `ciIteration=N`, and `inputArtifact` containing the structured failure list.
- [ ] Fixer runs claude with failure context, commits, and pushes; watcher then re-polls.
- [ ] After `CLAUFLOW_CI_MAX_FIX` (default 3) failed iterations, task moves to `review` with `agent.status="error"` and a clear escalation message; full failure history is queryable via `task_node_runs`.
- [ ] User abort (`POST /api/tasks/:id/abort`) cancels an in-flight ciWatcher (poll OR fixer node).
- [ ] User manual drag `ci → review` calls `ciWatcher.stop` and the poller exits.
- [ ] WS clients receive `ci_check_status`, `ci_iteration_started`, `ci_iteration_result`, and existing `node_started`/`node_finished` events for ci/fix rows.
- [ ] `TaskCard` displays a CI iteration badge for tasks in `ci` status.
- [ ] No regression in legacy single-claude or graph-runner paths for projects without a remote (still `done`) or with no checks (still `review` immediately).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Iteration cap bypass / runaway loop** — a bug in the loop (off-by-one, abort-not-honored) leaves the watcher polling and re-running fixer forever, burning tokens and PR commits. | M | H | Hard `CI_POLL_MAX_ITERS` cap independent of the verdict loop; controller chained to executor's; integration test for the "fail × 3 → escalate" path; emergency env var `CLAUFLOW_CI_DISABLE=1` bypasses the gate and reverts to direct `→review`. |
| **Abort cascade leaks** — executor's `RUNNING.delete(task.id)` happens *before* the watcher starts, so `abort(taskId)` only sees the watcher if we explicitly merge maps. Easy to silently break. | H | M | Update `abort()` to check both `RUNNING` and `WATCHERS`; integration test simulates abort during poll, during fix, and after fix-push. Document the dual-map contract in `ciWatcher.ts` header. |
| **`gh pr checks` flakiness / rate limits** — transient `gh` errors can be misread as `pending` (loops fine) or worse misread as terminal states. | M | M | Treat any non-zero `gh` exit as `pending` for the cycle (already in pseudocode); add a max-consecutive-error counter that escalates after K errors; record raw stderr in the ci `task_node_runs.errorMessage` for postmortem. |
| **Fixer makes no changes / loops with empty commits** — claude may decide the failure isn't fixable from the prompt and emit no diff. Without detection, we'd push nothing and re-poll same red state forever (until iteration cap). | M | M | If `commitAll` returns `nothing to commit` AND `git rev-list base..HEAD` count unchanged, mark fixer node as `error`, do NOT increment iteration uselessly — escalate immediately with reason "fixer produced no changes". |
| **5-column responsive layout** — current `md:grid-cols-2 xl:grid-cols-4` becomes orphan-prone at 5; small screens look broken. | L | L | Ship `xl:grid-cols-5`; accept md breakpoint imperfection in this phase. Polish in Phase 3 (Studio UX). |
| **`gh run view --log-failed` slow on large workflows** — could stall the watcher >30s per failure. | L | M | Run log fetches with a 20s timeout (`gitRun` already supports `signal`); on timeout, store `logTail: null` and proceed — the failing job names alone are usable input for fixer. |
| **Comment runner colliding with fixer on same branch** — user adds a comment while CI iteration in progress; commentRunner does `git checkout <branch>` and clobbers fixer mid-flight. | M | H | Document the constraint in code comment; future: extend `acquireSlot` to also block comments. For now, the executor slot lock already serializes by project — risk is contained to same-branch parallel comments. Add a TODO. |
| **Watcher survives server restart?** — Today: no. A restart leaves tasks stranded in `ci` forever. | H | M | Out of scope for this phase. Document; Phase 7 (Hardening) adds startup recovery: scan `tasks WHERE status='ci'` and re-attach watchers. |

---

*Generated: 2026-05-02*
*Status: READY FOR IMPLEMENTATION*
*Branch target: `feat/ci-gate-fix-loop` (off master)*
