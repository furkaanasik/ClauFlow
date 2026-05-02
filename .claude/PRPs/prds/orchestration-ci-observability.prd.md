# ClauFlow: Orchestration · CI Gate · Fleet Observability

> **Roadmap PRD bundling three sequenced bets that together move ClauFlow from "single-claude kanban" to "multi-agent orchestrated dev factory with quality and cost telemetry."**
>
> The bets are sequenced because each unlocks the next: orchestration produces richer per-step events → CI gate plugs in as a specialized node → observability becomes meaningful once there's multi-step, multi-iteration data to aggregate.

---

## Problem Statement

ClauFlow's drag-to-run agentic kanban is differentiated, but three structural gaps cap how far it can pull ahead of Conductor / Sculptor / Vibe Kanban / Claude Squad:

1. The Agent Studio canvas (ReactFlow graph in `gui/src/components/Studio/StudioCanvas.tsx`, persisted to `.claude/agents/_graph.json` and synced to `CLAUDE.md` via `projectsClaude.ts:742`) is **decorative** — at runtime a single `claude` process executes the whole task (`executor.ts` → `claudeService.ts:270`). Users design topologies that never run.
2. The executor is a "drag and pray" pipeline: tests are written and run inside the same claude session (`executor.ts:198`), but if they fail there is **no automatic fix loop and no quality gate before push**. Failed tests still produce a PR.
3. Per-task token usage exists (`TaskUsage` in `types/index.ts:23`, displayed via `gui/src/lib/cost.ts:4`) but **no fleet-level dashboard** aggregates spend, retry rate, comment-fix rate, or PR-merge rate. Pricing is hardcoded to Sonnet 4.5; multi-model runs would silently miscost.

The cost of not solving these: ClauFlow looks like "yet another claude wrapper" instead of an orchestration layer with quality and cost telemetry — exactly where the market (Devin, Factory, Sculptor) is moving.

## Evidence

- Inventory confirms `_graph.json` is persisted and `CLAUDE.md` is synced, but no consumer in `core/src/agents/` reads the graph to drive execution. Edges are dead data. *(Direct from codebase exploration, 2026-05-02.)*
- `executor.ts:466` rolls failed runs back to `todo` — no second-pass fix loop, no test-failure→fix-agent path.
- `cost.ts:4` hardcodes Sonnet 4.5 input/output/cache prices; the actual model used depends on the user's `claude` CLI default and is never detected. *(Bug today, blocker for multi-model later.)*
- Competitor scan (Conductor, Sculptor, Squad, Devin, Factory, Vibe Kanban) shows **none** offer a user-designable visual orchestration graph that actually runs. Closest is Factory's "Missions" but no UI to author them.
- Vibe Kanban is sunsetting; Crystal deprecated Feb 2026. Two adjacent user bases are unanchored. *(Source: competitor research dispatch, 2026-05-02.)*
- **Assumption flagged:** demand for visual graph authoring (vs. "just write a markdown spec") is unvalidated. See Open Questions.

## Proposed Solution

Ship three phases that compound:

**Phase A — Orchestration Runtime.** Make the Studio graph the source of truth for execution. A task entering `doing` is executed by a graph runner that walks nodes (`planner`, `coder`, `reviewer`, `tester`, `custom`), passing structured artifacts (analysis, diff, test output) between them. Each node is a `claude` invocation with its own prompt, allowed-tools, and optional model. Nodes emit existing WS events (`agent_log`, `tool_call_*`, `agent_text`) tagged with `nodeId`.

**Phase B — CI Gate Node + Fix Loop.** Introduce a first-class `ci` node type and a new `ci` kanban column between `doing` and `review`. The CI node runs the project's detected test/lint/typecheck commands outside claude, captures structured failures, and on red routes to a `fix` sub-node (claude session scoped to the failures) for up to N iterations before escalating to human.

**Phase C — Fleet Observability Dashboard.** A `/insights` page that aggregates the data Phases A+B already produce: per-project and per-node-type token spend, USD cost (model-aware pricing table), retry rate, CI pass rate, time-to-green, comment-fix rate, PR-merge rate. Backfills from existing `tasks` and `task_tool_calls` tables.

Why this approach over alternatives: each phase is shippable independently, each strengthens the others, and Phase A revives a feature already half-built rather than greenfield work.

## Key Hypothesis

We believe **a runnable visual orchestration graph + automated CI gate + cost/quality telemetry** will **convert ClauFlow from "single-claude wrapper" to a defensible multi-agent dev platform** for **solo devs and small teams who already use Claude Code daily**. We'll know we're right when:

- ≥40% of active projects switch their default execution from "single-node legacy" to a multi-node graph within 30 days of Phase A.
- Median time-to-mergeable-PR drops by ≥25% after Phase B (fewer review rounds because CI catches issues pre-PR).
- ≥1 external user cites the `/insights` dashboard as a reason for adopting/sticking, within 60 days of Phase C.

## What We're NOT Building

- **Container/Docker sandboxing.** Important but separate bet (Sculptor / Container Use). Doing it alongside orchestration would double the scope.
- **Multi-developer team collab** (presence, WS auth, per-user attribution). Deferred — see "Bahis 4" in the discovery doc; stands on its own.
- **Multi-model handoff.** Phase A makes per-node `model` configurable in the data model, but the v1 executor still calls `claude` only. Codex/Gemini support is a follow-on.
- **MCP server hosting.** Out of scope; can layer later.
- **Migration tooling for Vibe Kanban / Crystal users.** Tempting but distracts; revisit after Phase A ships.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Adoption of multi-node graphs | ≥40% of active projects within 30d of Phase A | Count of projects whose last 5 task runs used ≥2 distinct nodes (telemetry from Phase C dashboard, self-served) |
| CI gate effectiveness | ≥60% of CI-failed runs auto-resolved by fix loop within ≤2 iterations | `tasks` rows where `ci_iterations > 0 AND final_status='review|done'` |
| Time-to-mergeable-PR | -25% median vs. pre-Phase B baseline | `prMergedAt - createdAt` per task, cohort comparison |
| Cost transparency | 100% of completed tasks show model-aware USD ±5% of true API cost | Reconciliation against Anthropic billing for instrumented test projects |
| Phase A completion rate | ≥95% of multi-node graph runs reach a terminal state without manual intervention | `tasks.agentStatus IN ('done','error','aborted')` over started runs |
| Telemetry overhead | <5% increase in p50 task wall-clock vs. single-node baseline | Bench scripts run before/after Phase A |

## Open Questions

- [ ] Will users actually author graphs visually, or is `.claude/agents/_graph.json` + a YAML editor sufficient? (Validate with 3–5 power users before Phase A finalizes the editor.)
- [ ] Should node-to-node artifact passing be **structured** (typed JSON: `{ analysis, diff, testResults }`) or **freeform string**? Structured is more powerful but constrains node authors. *Lean structured with an `extra: string` escape hatch.*
- [ ] Where does the per-node `claude` process run — same repo working tree (current model) or per-node git worktree? Per-worktree enables future parallel branches but breaks comment-runner's branch-checkout assumption (`commentRunner.ts:42`).
- [ ] How are aborts propagated? Today: one `AbortController` per task in `RUNNING` map (`executor.ts:50`). With N nodes, abort = kill current node + cancel queued nodes; need explicit semantics.
- [ ] Hardcoded `bypassPermissions` in `.claude/settings.json` (committed to repo) is a security smell. Is Phase A the moment to make per-node tool whitelists the only way to grant tools?
- [ ] Cost reconciliation: stream-json `result` events sometimes miss cache fields on certain CLI versions (inferred from `executor.ts:319` fallback). Reliable cost tracking may need a separate Anthropic Usage API ingestion path.

---

## Users & Context

**Primary User**
- **Who**: Solo developer or 2–4 person team already using Claude Code daily, comfortable with `gh` CLI and SQLite, running ClauFlow locally against their own GitHub repos.
- **Current behavior**: Drags a card to `doing`, watches the agent log stream, opens the PR on GitHub, leaves review comments, occasionally retries when the task lands in `error`.
- **Trigger**: They have a backlog of small/medium changes (bugfixes, small features, refactors) and want to fan them out asynchronously while they focus elsewhere — but they don't trust the single-claude run enough to leave it unattended at scale.
- **Success state**: Drops 5 cards on Friday, comes back Monday to 4 mergeable PRs, 1 task escalated to them with a clear failure reason and partial work preserved. Per-project cost on the dashboard is within their mental budget.

**Job to Be Done**
When **I have a queue of well-scoped coding tasks and I want them done in parallel without me watching**, I want to **trust that each task is planned, implemented, tested, and reviewed by a configurable agent pipeline with cost guardrails**, so I can **spend my time on the 20% that requires my judgment instead of babysitting agents**.

**Non-Users**
- Enterprise teams needing SOC2 / SSO / audit trails — defer until team-collab phase.
- Users who want a hosted SaaS (no local install) — out of scope; ClauFlow is local-first.
- Users on languages/stacks where test runner auto-detection (`executor.ts:198`) doesn't work and who don't want to configure manually — Phase B will require some explicit config for them.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Graph runner that executes Studio graphs node-by-node, emitting per-node WS events | The headline differentiator; everything else builds on it |
| Must | Per-node `claude` invocation with own prompt, allowed-tools list, optional model field | Replaces hardcoded `allowedTools` (`claudeService.ts:270`) and unblocks future multi-model |
| Must | Structured artifact passing between nodes (`analysis`, `diff`, `testResults`, `extra`) | Without this, nodes are just sequential prompts — no real orchestration |
| Must | `ci` kanban column + node type running real `npm test` / `pnpm lint` / `tsc` outside claude | Quality gate that competitors don't have |
| Must | Auto-detect fix loop: CI red → fix sub-node with failures as input → re-run CI, max N iterations, then escalate | The "auto-resolved by claude" loop is the demo moment |
| Must | Model-aware pricing table (move pricing out of `cost.ts:4` into a config keyed by model id) | Phase C correctness; also fixes a current bug |
| Must | `/insights` page with per-project: tokens, USD, retry rate, CI pass rate, time-to-green, PR-merge rate | The observability bet itself |
| Must | Aggregation queries / materialized views over `tasks` + `task_tool_calls` + new `task_node_runs` table | Powers `/insights` without slow scans |
| Should | Migration path: existing single-node tasks keep working via a "legacy" graph (one `coder` node) | Backwards compat, zero-downtime adoption |
| Should | Per-node abort + retry from the task drawer | Aligns with existing `POST /api/tasks/:id/abort` and `/retry` semantics (`tasks.ts:243`, `:205`) |
| Should | Cost guardrail: per-task USD budget; pause + escalate when exceeded | Trust enabler for unattended runs |
| Should | CI runner output captured into `task_node_runs` so failures are inspectable in the timeline | Debuggability |
| Could | Visual run-trace overlay on the Studio canvas (highlight active node, color completed/failed) | Strong demo, not blocking |
| Could | Export `/insights` data as CSV / JSON | Power users only |
| Could | Cost burn-rate alerts (Slack / email) when project exceeds threshold | Nice for trust, not in v1 |
| Won't | Containerized per-node isolation | Separate bet; tracked elsewhere |
| Won't | Multi-developer presence / WS auth | Separate bet |
| Won't | Codex / Gemini executors in v1 | Data model ready, runtime later |

### MVP Scope (Phase A only — minimum to validate the core hypothesis)

A task in `doing` runs through a **3-node graph**: `planner` → `coder` → `reviewer`, persisted in `_graph.json`. Each node:
- Has its own prompt template + `allowedTools`.
- Receives prior-node artifacts as structured input.
- Emits WS events tagged with `nodeId`.

Single `claude` invocation per node, sequential, single working tree. Legacy single-node graphs keep working. No CI node yet, no `/insights` yet — those validate Phases B and C respectively.

If MVP validates (≥3 power users prefer the graph runner over single-node within 2 weeks of internal release), proceed to B; otherwise pivot to YAML-only graphs or kill Phase A.

### User Flow (critical path)

1. User opens Studio, drags `planner → coder → reviewer` nodes onto the canvas, saves graph.
2. User creates a task and drags to `doing`.
3. Graph runner reads `_graph.json`, queues nodes.
4. `planner` node runs → emits analysis artifact → board card shows "Planner ✓".
5. `coder` node runs with planner artifact as input → diff artifact → "Coder ✓".
6. `reviewer` node runs → review comments artifact → "Reviewer ✓".
7. Push + PR created (existing `executor.ts:410` logic).
8. Card moves to `review`.

Phase B inserts a `ci` node between coder and reviewer; Phase C surfaces the run on `/insights`.

---

## Technical Approach

**Feasibility**: **MEDIUM-HIGH**. Most building blocks exist; the work is wiring + a new state machine.

### Architecture Notes

- **New service `core/src/agents/graphRunner.ts`** replaces direct `executor.ts` invocation. The current `executor.ts` becomes a thin "single-node legacy" path. Comment-runner stays as-is for v1; later we can let comments target a specific node.
- **New table `task_node_runs`**: `id, taskId, nodeId, nodeType, status, startedAt, finishedAt, inputArtifact (JSON), outputArtifact (JSON), inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model, ciIteration (nullable), errorMessage`. Inline ALTER pattern matches `taskService.ts:107`.
- **WS events extended** (`types/index.ts:106` union): add `node_started`, `node_finished`, `node_log`, `ci_iteration_started`, `ci_iteration_result`. Existing `agent_log` events grow a `nodeId` field (backwards compatible: legacy events have no nodeId).
- **Pricing table** moves from `gui/src/lib/cost.ts:4` to `core/src/services/pricingService.ts` keyed by model id; GUI fetches via `GET /api/pricing` and caches. Server-side cost calculation is canonical (GUI-side becomes display-only).
- **CI node** shells out to detected test/lint/typecheck commands (reuse detection from `executor.ts:198`); structured failure parsing per language (Jest JSON reporter, `tsc --pretty=false`, ESLint JSON formatter). Failures pass to fix-node as `{ failures: [{ file, line, message }, …] }`.
- **Fix loop** is a graph edge type, not a hardcoded behavior — `ci → fix → ci` is cyclic with `maxIterations` on the edge. This generalizes for future use.
- **`/insights` page** queries pre-aggregated views; refresh on demand + WS-driven invalidation. No real-time charts in v1.

### Technical Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Per-node prompts blow up token cost vs. single monolithic prompt | M | Phase A includes side-by-side cost telemetry on a small benchmark suite before declaring victory |
| `claude` stream-json idle/abort semantics break across N nodes | M | Reuse existing `AbortController` map (`executor.ts:50`) per node; explicit cancel-cascade test cases |
| Test runner detection misses real-world projects, breaking CI node | M | Phase B ships with explicit `ci.command` override in project settings; auto-detect is best-effort |
| ESLint/tsc output parsing brittle | M | Start with line-pattern parsing, accept some fix-loop iterations being unstructured strings |
| Concurrent CI iterations + comment-runner on same branch corrupt state | H | CI node respects the same DB slot lock as executor (`executor.ts:35`); document that comment runs queue behind in-flight CI |
| Pricing table drifts from Anthropic's actual prices | L | Store pricing config in repo; document update process; add a "stale pricing" warning in `/insights` if config older than 90d |
| Graph cycles (fix-loop) infinite-run if `maxIterations` not enforced | H | Hard cap (default 3) enforced in graphRunner; UI surfaces remaining iterations; cost guard kills run when exceeded |
| Migrating existing tasks to "legacy graph" breaks running executors during deploy | M | Version the graphRunner; on startup, finish in-flight runs on the legacy path before switching |
| Studio canvas UX for cyclic edges (CI fix loop) confusing in ReactFlow | L | Explicit "max iterations" badge on cycle edges; validate graph on save |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundations | Pricing service, `task_node_runs` table, WS event additions, legacy-graph adapter | complete | - | - | [.claude/PRPs/plans/completed/foundations-pricing-node-runs.plan.md](../plans/completed/foundations-pricing-node-runs.plan.md) → [report](../reports/foundations-pricing-node-runs-report.md) |
| 2 | Graph Runner MVP (Bet 1) | Linear `planner → coder → reviewer` execution, per-node prompts/tools, artifact passing | complete | - | 1 | [.claude/PRPs/plans/completed/graph-runner-mvp.plan.md](../plans/completed/graph-runner-mvp.plan.md) → [report](../reports/graph-runner-mvp-report.md) |
| 3 | Studio Runtime UX | Run-trace overlay, per-node abort/retry, graph validation on save | complete | with 4 | 2 | [.claude/PRPs/plans/completed/studio-runtime-ux.plan.md](../plans/completed/studio-runtime-ux.plan.md) → [report](../reports/studio-runtime-ux-report.md) |
| 4 | CI Gate + Fix Loop (Bet 2) | `ci` column + node, structured failure parsing, fix sub-node, cycle iteration cap | pending | with 3 | 2 | - |
| 5 | Cost Guardrails | Per-task USD budget, pause-and-escalate, model-aware accounting end-to-end | pending | - | 1, 4 | - |
| 6 | Fleet Dashboard (Bet 3) | `/insights` page, aggregation queries/views, export | pending | - | 2, 4, 5 | - |
| 7 | Hardening | Migration safety, abort cascade tests, pricing-staleness warnings, docs | pending | - | 6 | - |

### Phase Details

**Phase 1: Foundations**
- **Goal**: De-risk later phases by landing the data + pricing changes that everything else assumes.
- **Scope**: New `task_node_runs` table (idempotent ALTER pattern). New `pricingService.ts` keyed by model id; GUI cost.ts becomes a thin client. New WS events added behind a feature flag. A "legacy graph" adapter so existing single-node executor runs are written into `task_node_runs` as a single row, making Phase 6 backfillable.
- **Success signal**: All existing tests still pass; new pricing endpoint returns correct values; running an existing task produces one `task_node_runs` row with accurate token+cost data.

**Phase 2: Graph Runner MVP (Bet 1)**
- **Goal**: Make the Studio graph drive execution end-to-end for the canonical `planner → coder → reviewer` pipeline.
- **Scope**: `core/src/agents/graphRunner.ts` reads `_graph.json`, walks nodes, invokes `claude` per node with its own prompt/tools, passes structured artifacts between nodes, emits per-node WS events. Existing `executor.ts:410` PR-creation logic becomes the terminal step after the last node. Single working tree, sequential execution. Legacy single-node graphs continue to work.
- **Success signal**: A new task with the canonical 3-node graph runs to completion without human intervention; per-node logs visible in `TaskDetailDrawer`; legacy single-node tasks unchanged.

**Phase 3: Studio Runtime UX**
- **Goal**: Make graph runs observable and recoverable from the Studio canvas.
- **Scope**: Visual overlay highlighting active/completed/failed nodes during a run; per-node abort + retry endpoints (`POST /api/tasks/:id/nodes/:nodeId/abort|retry`); graph validation on save (no orphan nodes, exactly one entry, terminal node with PR-create capability).
- **Success signal**: Power user can author a graph in Studio, see it run live, abort a stuck node and retry it without restarting the whole task.

**Phase 4: CI Gate + Fix Loop (Bet 2)**
- **Goal**: Quality gate before push with automatic fix-loop.
- **Scope**: New `ci` kanban column between `doing` and `review`; new `ci` and `fix` node types; structured failure parsing for Jest/Vitest, `tsc`, ESLint; cyclic edge `ci → fix → ci` with `maxIterations` (default 3); failure artifact piped into fix node prompt; explicit `ci.command` override in project settings as fallback for auto-detect failures.
- **Success signal**: Intentionally introduce a failing test in a benchmark task; CI node detects red, fix node patches, CI re-runs green, PR opens — all without human input. Failure escalation also works (3 iterations red → escalate to `error` with full failure history preserved).

**Phase 5: Cost Guardrails**
- **Goal**: Make unattended runs trustworthy.
- **Scope**: Per-task USD budget (default + per-project override); graphRunner pauses + escalates when exceeded; budget shown in task drawer with progress bar; model-aware accounting validated end-to-end against Anthropic billing on a 50-task benchmark.
- **Success signal**: Synthetic over-budget task pauses at the right point with partial work preserved; cost reconciliation within ±5% of Anthropic billing.

**Phase 6: Fleet Dashboard (Bet 3)**
- **Goal**: Surface the data Phases A+B produce as a reason-to-stay.
- **Scope**: `/insights` page with per-project cards: tokens, USD, retry rate, CI pass rate, time-to-green, PR-merge rate, comment-fix rate. Per-node-type breakdown for power users. Aggregation queries against `task_node_runs` with materialized views or scheduled rollups if perf demands. Export CSV/JSON.
- **Success signal**: Dashboard loads in <500 ms p50 for a 1000-task project; numbers reconcile against raw queries; ≥1 power user voluntarily references the dashboard within 2 weeks of release.

**Phase 7: Hardening**
- **Goal**: Make the bundle production-quality before broad announcement.
- **Scope**: Abort-cascade test cases (kill mid-CI iteration, kill mid-fix); migration safety on deploy (in-flight executor runs finish on legacy path); pricing staleness warnings (if pricing config >90 days old); docs covering graph authoring, CI override config, budget config; load test for `/insights` aggregation.
- **Success signal**: Two consecutive weeks with zero stuck tasks across staging users; docs landed; release notes drafted.

### Parallelism Notes

Phases 3 (Studio UX) and 4 (CI Gate) are independent once Phase 2 lands — UX work is pure GUI + abort/retry endpoints; CI is server-side new node type + parsing. Two contributors (or one Codex + one Gemini in `/multi-workflow`) can run them concurrently. Phase 5 depends on Phase 4 (needs realistic node-level cost data) but is independent of Phase 3. Phase 6 needs Phases 4+5 to have data worth aggregating. Phase 7 is sequential at the end.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Graph storage | Reuse existing `_graph.json` + `CLAUDE.md` sync | New DB-only schema; YAML in repo | `_graph.json` already exists and is git-tracked; zero migration; users can hand-edit |
| Artifact passing | Structured JSON with `extra: string` escape hatch | Freeform string only; strict typed-only | Powerful by default, escape hatch keeps node authors unblocked |
| Per-node working tree | Single shared tree (current model) | Per-node git worktree | Per-worktree breaks `commentRunner.ts:42` assumption; shared tree is simpler for v1; revisit when adding parallel branches |
| CI runner location | Outside claude (real `npm test` etc.) | Inside claude session (current behavior) | Trustable signal; cheaper; structured failure capture; matches industry CI semantics |
| Fix loop semantics | Cyclic graph edge with `maxIterations` | Hardcoded retry in CI node | Generalizes for future cycles; visible in Studio; user-configurable |
| Pricing config | Server-side keyed by model id, GUI fetches | Keep in `cost.ts:4` | Fixes current Sonnet-only bug; required for multi-model later |
| Backwards compat | Legacy single-node graph adapter | Force migration | Zero downtime; existing tasks keep working; Phase 6 backfillable |
| Auth/isolation | Out of scope (deferred to team-collab bet) | Bundle here | Bundling triples scope without sharpening hypothesis |
| Multi-model executor in v1 | Data model ready, runtime claude-only | Add Codex/Gemini in v1 | Each executor needs its own stream parsing + retry; deserves own bet |

---

## Research Summary

**Market Context**

- Claude Squad, Conductor, Sculptor all run parallel agents in worktrees but expose **no user-authored orchestration** — the topology is hardcoded. Factory's "Missions" come closest but no UI to design them.
- Vibe Kanban (BloopAI) sunsetting late 2025; Crystal deprecated Feb 2026 (replaced by Nimbalyst). Two adjacent user bases unanchored — strong tailwind for Phase A's announcement.
- Cost observability is now table-stakes for production agents (Helicone, Braintrust, Langfuse, Devin's ACUs) but **no agent-kanban competitor** has integrated it. White-space for Phase C.
- 2025–26 trend: sub-agents + worktree fork standardized in Claude Code; multi-model handoff growing (Factory: Claude plan → DeepSeek code). Phase A's per-node `model` field positions ClauFlow on this trend without committing to it in v1.

**Technical Context**

- Studio graph already persists to `_graph.json` and syncs to `CLAUDE.md` (`projectsClaude.ts:742`) — runtime is the only missing piece, not authoring.
- Executor already has the right primitives: AbortController per task (`executor.ts:50`), DB slot lock (`executor.ts:35`), retry+fallback (`claudeService.ts:216`, `executor.ts:319`), token capture (`executor.ts:291`). Phase 2 wraps these in a node loop.
- Test runner auto-detection exists (`executor.ts:198`) — Phase 4 reuses it for the CI node, with explicit override as fallback.
- WS event union (`types/index.ts:106`) is closed-typed; adding node-tagged variants is straightforward.
- No CI / test infrastructure in the repo today — Phase 7 is the right time to add baseline tests for graphRunner + CI parser.
- `bypassPermissions` committed to `.claude/settings.json` is a security smell; Phase A's per-node tool whitelist makes it possible to remove that default — flagged as Open Question.

---

*Generated: 2026-05-02*
*Status: DRAFT - needs validation*
*Branch: master*
