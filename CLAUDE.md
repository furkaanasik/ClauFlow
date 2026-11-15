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
3. The core route handler kicks off the executor fire-and-forget. The executor first waits for the **repo lock** (`services/repoLock.ts`, FIFO per real repo path, no timeout); a waiting task shows as queued and can be aborted without touching git
4. Executor: `gh auth setup-git` → checkout base (a dirty tree is stashed) → branch (an old branch that carries commits is kept as `<branch>-wip-N`) → `runTeam` (one `claude -p` call per team role: CEO → Analyst → Developer ⇄ QA, commit after the Developer). Teams live in the DB (`teams`, `task_team_runs`, `task_team_artifacts`), never in the repo; the task's `teamId` falls back to the project's `defaultTeamId`, then Solo
5. Each step broadcasts `agent_log` / `agent_status` / `task_updated` over WebSocket
6. The GUI's `useAgentSocket` hook (mounted once, in `AppShell`) receives events → the Zustand store updates
7. The task always ends in `review` with its branch kept, and the repo returns to the base branch. With a remote: `git push --force-with-lease` + `gh pr create`. Without a remote: no push, no PR; the drawer's "Changes" tab shows the local diff (`GET /api/tasks/:id/diff`). If the team changed nothing, the task goes to `done` and the branch is deleted
8. Dragging Review → Done merges (see below). Cost is real: every role, comment, breakdown and planner run adds the CLI's `total_cost_usd` to `tasks.costUsd` / `projects.planningCostUsd`

## Comment Flow (Task Comments + AI)

1. The user adds a comment on a task in `review` (or in `done` while its branch still exists; never while `doing` → `409 task_running`)
2. GUI calls `POST /api/tasks/:id/comments` (`{ body: "..." }`)
3. The backend stores the comment in the `comments` table and starts `commentRunner` fire-and-forget
4. The runner waits for the repo lock, checks out the task's `branch` → applies the comment via the `claude` CLI → commit → push only if a remote exists (does not open a PR). Afterwards leftover edits go to a `clauflow-comment-<id>` stash and the repo returns to the base branch
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
- `gh auth setup-git` is called on every executor run to refresh git credentials
- Dragging Review → Done calls `mergeService.mergeTaskBranch` synchronously inside the PATCH: with a PR, `gh pr merge --merge --delete-branch`; without a remote, a local `git merge --no-ff` into the base and `git branch -d`. On a conflict the merge is aborted, the task stays in Review and the PATCH returns `409 merge_conflict` with the files. The PR drawer's merge button uses the same function
- The repo lock is shared: the executor and comment runner wait for it; the merge and the CLAUDE.md editor do not wait and return `409 repo_busy`
- Executor failure → task returns to `todo`, `agent.status: "error"`, `agent.error` holds a code
- `comments` table: `id, taskId, body, status (pending/running/done/error), agentLog, createdAt`
- Comment WS event: `comment_updated` — `{ type, taskId, payload: Comment }`
