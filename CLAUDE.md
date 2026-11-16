# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Workflow

Do small, localized work directly: questions, a few-line fix, docs, config, file moves, string or style tweaks. For larger work (several areas, a new feature, a non-trivial refactor) plan first, then implement and review the diff before committing.

> **Note:** This guidance is for working *on this repo*. The runtime agents inside `core/src/agents/` (executor, team runner, comment runner, planner) are part of the ClauFlow product itself and are unrelated to this workflow.

## Command Cheatsheet

Quick reference for skills used in this repo. Pick the smallest tool that fits the job.

| Scenario | Primary | Alternative | Notes |
|----------|---------|-------------|-------|
| **Suggest new things** (discovery / "what could we add?") | `/prp-prd` | `/feature-dev` | `/prp-prd` is problem-first, hypothesis-driven; `/feature-dev` is single-feature guided |
| **Plan only** (no code yet) | `/plan` | — | |
| **Code review** | `/code-review` | `/review-pr <PR#>` | Local diff vs GitHub PR |
| **Security review** | `/security-review` | — | Auth, input handling, payments, secrets |
| **TDD feature/bugfix** | `/tdd-workflow` | — | Test-first workflow |
| **Build broken** | `/build-fix` | — | TS / lint / compile errors |
| **Smart commit** | `/commit` | `/prp-commit` | Conventional commits + smart file grouping |
| **Open a PR** | `/prp-pr` | — | Branch → PR with summary |
| **Dead code cleanup** | `/refactor-clean` | — | knip / depcheck / ts-prune sweep |
| **Raise test coverage** | `/test-coverage` | — | Fill gaps to hit 80% |

Typical flow: `/plan` → write code → `/code-review` → `/commit`.

For open-ended analysis or feature-suggestion prompts (e.g. "incele ve neler eklenebilir?"), prefer `/prp-prd` or `/feature-dev` over a freeform brainstorm.

## Services

Two separate packages, run independently:

| Service | Directory | Port | Command |
|--------|-------|------|-------|
| Backend (core) | `core/` | 3001 | `npm run dev` |
| Frontend (gui) | `gui/` | 3000 | `pnpm dev` |

```bash
# Backend
cd core && npm run dev

# Frontend
cd gui && pnpm dev

# Type check
cd core && npm run typecheck
cd gui && pnpm typecheck

# Tests (core only, vitest)
cd core && npm test

# Lint (gui only, must stay at 0 warnings)
cd gui && pnpm lint

# Build
cd core && npm run build
cd gui && pnpm build
```

## Core Data Flow

1. User drags a card from `todo → doing`
2. GUI sends `PATCH /api/tasks/:id` with `status: "doing"` (plus `uiLang`, the language of the team summary and PR text)
3. The route first checks that the project's base branch exists in the repo (`422 { error: "base_branch_missing", current }`, task unchanged), then passes the **dependency gate** (`services/chainService.ts` `gateDoing`): with any dependency not `done` the task does not start; it stays in `doing` with `agent.status: "waiting_deps"`, holds no repo lock, and abort returns it to `todo` (`aborted_while_waiting`) without touching git. Otherwise the core kicks off the executor fire-and-forget. The executor first waits for the **repo lock** (`services/repoLock.ts`, FIFO per real repo path, no timeout); a queued task shows as queued and can be aborted without touching git
4. Executor: base-branch check → `gh auth setup-git` (only when the repo has a remote; no `gh` on PATH → `gh_missing`, before any git write) → checkout base (a dirty tree is stashed) → branch (an old branch that carries commits is kept as `<branch>-wip-N`) → `runTeam` (one `claude -p` call per team role: CEO → Analyst → Developer ⇄ QA, commit after the Developer). Teams live in the DB (`teams`, `task_team_runs`, `task_team_artifacts`), never in the repo; the task's `teamId` falls back to the project's `defaultTeamId`, then Solo
5. Each step broadcasts `agent_log` / `agent_status` / `task_updated` over WebSocket
6. The GUI's `useAgentSocket` hook (mounted once, in `AppShell`) receives events → the Zustand store updates
7. The task always ends in `review` with its branch kept, and the repo returns to the base branch. With a remote: `git push --force-with-lease` + `gh pr create`. Without a remote: no push, no PR; the drawer's "Changes" tab shows the local diff (`GET /api/tasks/:id/diff`). If the team changed nothing, the task goes to `done` and the branch is deleted
8. Dragging Review → Done merges (see below). When a task becomes `done` by any path (merge, no-change run, PATCH), every waiting dependent whose dependencies are now all `done` starts automatically (`chain_advanced` WS event), so it branches from a base that already holds its predecessors' code. A merge conflict starts the AI conflict resolver once; the task stays in Review and is never merged automatically. Cost is real: every role, comment, breakdown and planner run adds the CLI's `total_cost_usd` to `tasks.costUsd` / `projects.planningCostUsd`

## Comment Flow (Task Comments + AI)

1. The user adds a comment on a task in `review` (or in `done` while its branch still exists; never while `doing` → `409 task_running`, nor while the conflict resolver runs → `409 conflict_resolving`)
2. GUI calls `POST /api/tasks/:id/comments` (`{ body: "...", uiLang }`)
3. The backend stores the comment in the `comments` table and starts `commentRunner` fire-and-forget
4. The runner waits for the repo lock, runs `gh auth setup-git` only when the repo has a remote (`gh_missing` without `gh`), checks out the task's `branch` → applies the comment as the team's Developer role (its model, tools, isolation and budget, plus the request's `uiLang`; node run `role:comment:<n>`) → commit → push only if a remote exists (does not open a PR). Afterwards leftover edits go to a `clauflow-comment-<id>` stash and the repo returns to the base branch
5. Each step broadcasts `comment_updated` over WebSocket
6. In the UI a spinner sits next to the comment → green check (done) / red error (error)

## Important Details

- `core/` uses `npm`, `gui/` uses `pnpm` — never cross them
- `core/` has vitest tests (`npm test`, fake CLI in `core/src/agents/__fixtures__/fake-claude.mjs`, helpers in `core/src/test-utils/`); add or update tests with core changes. The gui has no test runner
- **Claude CLI invocation**: `-p <prompt>` must be the first argument; other flags (`--permission-mode`, etc.) come after
- `window.confirm` is not used — use `ConfirmDialog` (`gui/src/components/ui/ConfirmDialog.tsx`)
- Theme: `cream` is the default (`:root` tokens), `night` adds the `html.night` class; the choice is stored in `localStorage.theme` (`gui/src/lib/theme.ts`, `gui/src/hooks/useTheme.ts`)
- Language preference: `lang` Zustand state → `useTranslation()` hook; new strings go into `tr.ts` + `en.ts` + `types.ts`
- Errors sent to the GUI are codes (`{ error: "repo_busy" }`, `agent.error = "aborted_by_user"`); the GUI translates them with `errorText(t, raw)` (`gui/src/lib/errorText.ts`, `t.errors.*`)
- `gh auth setup-git` (`gitService.ensureGhCredentials`) runs only when the repo has a remote (executor, comment runner, conflict resolver); without a remote `gh` is never spawned. A missing `gh` with a remote fails as `gh_missing` before any git write
- **Task chains**: `task_dependencies(taskId, dependsOnId, createdAt)` table (same project only, edges deleted with the task); `Task.dependsOn` lists the dependency ids. `PUT /api/tasks/:id/dependencies` (`{ dependsOn: string[] }`) replaces the set, only while the task is in `todo` or waiting (`409 dependencies_locked` otherwise); a cycle is `409 dependency_cycle` with `path`, plus `dependency_self`, `dependency_not_found`, `dependency_cross_project`, `too_many_dependencies`. The planner and task breakdown can emit dependencies (`key` / `dependsOn` per item). `tasks.waitUiLang` keeps the `uiLang` a waiting task was started with. `POST /api/tasks/:id/start-waiting` starts a waiting task whose dependencies are all done (`409 not_waiting` / `409 dependencies_unmet` with `unmet`); boot never auto-starts waiting tasks, it only logs the ready ones and the board shows a "Start" strip
- Dragging Review → Done first opens a `ConfirmDialog` (branch/PR, dirty-tree stash, how many waiting tasks will start), then calls `mergeService.mergeTaskBranch` synchronously inside the PATCH: with a PR, `gh pr merge --merge --delete-branch`; without a remote, a local `git merge --no-ff` into the base and `git branch -d`. The PR drawer's merge button uses the same function
- **Conflict resolver** (`agents/conflictResolver.ts`): on a merge conflict (local, or a PR that `gh pr view` reports as conflicting) the merge is aborted, the PATCH returns `409 { error: "merge_conflict", files, resolving }` and the task stays in Review with `agent.status: "resolving_conflict"`. One automatic run per conflict (none if the previous attempt ended `conflict_unresolved:*`; then `resolving: false`): repo lock → backup ref `refs/clauflow/pre-resolve/<id>` → checkout the task branch → merge the base into it (rerere disabled) → the team's Developer role resolves the markers → marker check (`git diff --check` + marker scan) → commit → one QA round → push with `--force-with-lease` if a remote exists → back to base. It never merges into the base; the user approves Review → Done again. Success → `agent.status: "done"`, `currentStep: "conflict_resolved"` (a clean merge with no AI and no QA → `branch_updated`). Failure (markers left, QA FAIL, timeout, budget, abort, push) restores the branch to its previous SHA and sets `agent.error = "conflict_unresolved:<reason>"`. `POST /api/tasks/:id/resolve` (`{ mode: "conflict" | "update" }`, `202 { task }`) is the drawer's "Resolve with AI" / "Update branch"; `GET /api/tasks/:id/base-drift` reports how far the base moved since the branch left it (no fetch, no lock). While resolving, status/agent/branch PATCHes, comments, delete and a second resolve return `409 conflict_resolving`. Boot marks interrupted runs `conflict_unresolved:server_restart` and restores their branches from the backup ref
- The repo lock is shared: the executor, comment runner and conflict resolver wait for it (FIFO); the merge, the CLAUDE.md editor and stash restore/drop do not wait and return `409 repo_busy`
- Executor failure → task returns to `todo`, `agent.status: "error"`, `agent.error` holds a code: `base_branch_missing:<current>`, `gh_missing`, `git_checkout_failed:<first line>`, `git_push_failed`, `pr_create_failed`, `claude_exit`, `run_failed:<first 120 chars>`, `role_timeout:<role>` (`agents/runErrorCode.ts`; `errorText` fills the `:<detail>` part)
- Role timeout: each role call is limited by `CLAUFLOW_ROLE_TIMEOUT_MS` (default 20 min); on timeout the CLI's whole process tree is killed and the run stops with `role_timeout:<role>` (half-done work is kept as a `wip:` commit). The repo lock itself still has no timeout
- Stashes ClauFlow takes (`kanban-auto-…`, `clauflow-merge-<id>`, `clauflow-comment-<commentId>`, `clauflow-resolve-<id>`) are listed by `GET /api/projects/:id/stashes`, restored by `POST /api/projects/:id/stashes/:ref/restore` and dropped by `DELETE /api/projects/:id/stashes/:ref` (`:ref` is the 40-char SHA; `stash_conflict`, `worktree_dirty`, `stash_not_found`). A new stash broadcasts `stash_created` (`{ projectId, label, reason, displayId }`); the project drawer shows them
- `comments` table: `id, taskId, body, status (pending/running/done/error), agentLog, createdAt`
- Comment WS event: `comment_updated` — `{ type, taskId, payload: Comment }`
- Chain WS event: `chain_advanced` — `{ type, taskId, payload: { projectId, displayId, merged, started: [{ id, displayId }] } }`
