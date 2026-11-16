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
4. Executor: base-branch check → `gh auth setup-git` (only when the repo has a remote; no `gh` on PATH → `gh_missing`, before any git write) → checkout base (stash hygiene first: untracked safe noise folders such as `node_modules/` or `.next/` go into ClauFlow's `.git/info/exclude` block; only the remaining real dirt is stashed, see "Stash hygiene") → branch (an old branch that carries commits is kept as `<branch>-wip-N`) → `runTeam` (one `claude -p` call per team role: CEO → Analyst → Developer ⇄ QA, commit after the Developer). Teams live in the DB (`teams`, `task_team_runs`, `task_team_artifacts`), never in the repo; the task's `teamId` falls back to the project's `defaultTeamId`, then Solo
5. Each step broadcasts `agent_log` / `agent_status` / `task_updated` over WebSocket
6. The GUI's `useAgentSocket` hook (mounted once, in `AppShell`) receives events → the Zustand store updates
7. The task always ends in `review` with its branch kept, and the repo returns to the base branch. With a remote: `git push --force-with-lease` + `gh pr create`. Without a remote: no push, no PR; the drawer's "Changes" tab shows the local diff (`GET /api/tasks/:id/diff`). If the team changed nothing, the task goes to `done` and the branch is deleted. Right after the team run the executor checks that the base branch still exists: if it was renamed or deleted mid-run, the task goes back to `todo` with `agent.error = base_branch_missing:<task branch>`, any dirt is committed as `wip:`, the branch and its commits are kept and the repo stays on it (never `done`, so no chain start)
8. Dragging Review → Done merges (see below). When a task becomes `done` by any path (merge, no-change run, PATCH), every waiting dependent whose dependencies are now all `done` starts automatically (`chain_advanced` WS event), so it branches from a base that already holds its predecessors' code. A merge conflict starts the AI conflict resolver once; the task stays in Review and is never merged automatically. Cost is real: every role, comment, breakdown and planner run adds the CLI's `total_cost_usd` to `tasks.costUsd` / `projects.planningCostUsd`

## Comment Flow (Task Comments + AI)

1. The user adds a comment on a task in `review` (or in `done` while its branch still exists; never while `doing` → `409 task_running`, nor while the conflict resolver runs → `409 conflict_resolving`)
2. GUI calls `POST /api/tasks/:id/comments` (`{ body: "...", uiLang }`, plus `attachmentIds` when images were attached: they are uploaded first as drafts and linked to the comment before the runner starts, see "Image attachments")
3. The backend stores the comment in the `comments` table and starts `commentRunner` fire-and-forget
4. The runner waits for the repo lock, runs `gh auth setup-git` only when the repo has a remote (`gh_missing` without `gh`), checks out the task's `branch` → applies the comment as the team's Developer role (its model, tools, isolation and budget, plus the request's `uiLang`; node run `role:comment:<n>`) → commit → push only if a remote exists (does not open a PR). Afterwards leftover edits go to a `clauflow-comment-<id>` stash and the repo returns to the base branch
5. Each step broadcasts `comment_updated` over WebSocket
6. In the UI a spinner sits next to the comment → green check (done) / red error (error)

## Important Details

- `core/` uses `npm`, `gui/` uses `pnpm` — never cross them
- `core/` has vitest tests (`npm test`, fake CLI in `core/src/agents/__fixtures__/fake-claude.mjs`, helpers in `core/src/test-utils/`); add or update tests with core changes. The gui has no test runner
- **Claude CLI invocation**: every call is `claude -p --permission-mode … [flags]` with no positional prompt; the prompt is written to the child's stdin and stdin is closed (`claudeService.runClaude`). Never put the prompt in argv: Linux caps one argument at 128 KiB, and a pasted design doc exceeds that. Context sections are capped at `SECTION_CHAR_CAP` (400 000 chars); comments and breakdown prompts at 500 000; the Express JSON limit is 5 MB (`core/src/utils/http.ts`)
- `window.confirm` is not used — use `ConfirmDialog` (`gui/src/components/ui/ConfirmDialog.tsx`)
- Theme: `cream` is the default (`:root` tokens), `night` adds the `html.night` class; the choice is stored in `localStorage.theme` (`gui/src/lib/theme.ts`, `gui/src/hooks/useTheme.ts`)
- Language preference: `lang` Zustand state → `useTranslation()` hook; new strings go into `tr.ts` + `en.ts` + `types.ts`
- Errors sent to the GUI are codes (`{ error: "repo_busy" }`, `agent.error = "aborted_by_user"`); the GUI translates them with `errorText(t, raw)` (`gui/src/lib/errorText.ts`, `t.errors.*`)
- `gh auth setup-git` (`gitService.ensureGhCredentials`) runs only when the repo has a remote (executor, comment runner, conflict resolver); without a remote `gh` is never spawned. A missing `gh` with a remote fails as `gh_missing` before any git write
- **Task chains**: `task_dependencies(taskId, dependsOnId, createdAt)` table (same project only, edges deleted with the task); `Task.dependsOn` lists the dependency ids. `PUT /api/tasks/:id/dependencies` (`{ dependsOn: string[] }`) replaces the set, only while the task is in `todo` or waiting (`409 dependencies_locked` otherwise); a cycle is `409 dependency_cycle` with `path`, plus `dependency_self`, `dependency_not_found`, `dependency_cross_project`, `too_many_dependencies`. The planner and task breakdown can emit dependencies (`key` / `dependsOn` per item). `tasks.waitUiLang` keeps the `uiLang` a waiting task was started with. `POST /api/tasks/:id/start-waiting` starts a waiting task whose dependencies are all done (`409 not_waiting` / `409 dependencies_unmet` with `unmet`); boot never auto-starts waiting tasks, it only logs the ready ones and the board shows a "Start" strip
- Dragging Review → Done first opens a `ConfirmDialog` (branch/PR, dirty-tree stash, how many waiting tasks will start), then calls `mergeService.mergeTaskBranch` synchronously inside the PATCH: with a PR, `gh pr merge --merge --delete-branch`; without a remote, a local `git merge --no-ff` into the base and `git branch -d`. The PR drawer's merge button uses the same function
- **Conflict resolver** (`agents/conflictResolver.ts`): on a merge conflict (local, or a PR that `gh pr view` reports as conflicting) the merge is aborted, the PATCH returns `409 { error: "merge_conflict", files, resolving }` and the task stays in Review with `agent.status: "resolving_conflict"`. One automatic run per conflict (none if the previous attempt ended `conflict_unresolved:*`; then `resolving: false`): repo lock → backup ref `refs/clauflow/pre-resolve/<id>` → checkout the task branch → merge the base into it (rerere disabled) → the team's Developer role resolves the markers → marker check (`git diff --check` + marker scan) → commit → one QA round → push with `--force-with-lease` if a remote exists → back to base. It never merges into the base; the user approves Review → Done again. Success → `agent.status: "done"`, `currentStep: "conflict_resolved"` (a clean merge with no AI and no QA → `branch_updated`). Failure (markers left, QA FAIL, timeout, budget, abort, push) restores the branch to its previous SHA and sets `agent.error = "conflict_unresolved:<reason>"`. `POST /api/tasks/:id/resolve` (`{ mode: "conflict" | "update" }`, `202 { task }`) is the drawer's "Resolve with AI" / "Update branch"; `GET /api/tasks/:id/base-drift` reports how far the base moved since the branch left it (no fetch, no lock). While resolving, status/agent/branch PATCHes, comments, delete and a second resolve return `409 conflict_resolving`. Boot marks interrupted runs `conflict_unresolved:server_restart` and restores their branches from the backup ref
- The repo lock is shared: the executor, comment runner and conflict resolver wait for it (FIFO); the merge, the CLAUDE.md editor and stash restore/drop do not wait and return `409 repo_busy`
- Executor failure → task returns to `todo`, `agent.status: "error"`, `agent.error` holds a code: `base_branch_missing:<current>`, `gh_missing`, `git_checkout_failed:<first line>`, `git_push_failed`, `pr_create_failed`, `claude_exit`, `run_failed:<first 120 chars>` (`run_failed:rev-list` when counting the branch's commits fails; the branch is kept), `role_timeout:<role>` (`agents/runErrorCode.ts`; `errorText` fills the `:<detail>` part)
- Role timeout: each role call is limited by `CLAUFLOW_ROLE_TIMEOUT_MS` (default 20 min); on timeout the CLI's whole process tree is killed and the run stops with `role_timeout:<role>` (half-done work is kept as a `wip:` commit). The repo lock itself still has no timeout
- Stashes ClauFlow takes (`kanban-auto-…`, `clauflow-merge-<id>`, `clauflow-comment-<commentId>`, `clauflow-resolve-<id>`) are listed by `GET /api/projects/:id/stashes`, restored by `POST /api/projects/:id/stashes/:ref/restore` and dropped by `DELETE /api/projects/:id/stashes/:ref` (`:ref` is the 40-char SHA; `stash_conflict`, `worktree_dirty`, `stash_not_found`). A new stash broadcasts `stash_created` (`{ projectId, label, reason, displayId }`); the project drawer shows them
- **Stash hygiene** (`services/noisePaths.ts`, `gitService.shieldNoiseDirs`): before every ClauFlow stash (`-u`) and every `git add -A` (executor checkout, `commitAll`, local merge, comment runner, team discard, conflict resolver) the "shield" lists `git status --porcelain=v1 -z --untracked-files=normal`; each **wholly untracked** folder whose last segment is in `SHIELD_DIRS` (`node_modules`, `.venv`, `__pycache__`, `.next`, `dist`, `coverage`, …) is appended as `/<path>/` to a tagged block in `.git/info/exclude` (`# >>> ClauFlow (automatic; …)` … `# <<< ClauFlow`). If nothing else is dirty, no stash is taken and the folders stay in place; otherwise only the real files are stashed. Ambiguous folders (`build/`, `out/`, `target/`, `vendor/`, `.cache/`) are never shielded (they can hold hand-written code) and are stashed as before. Ignored files are never stashed (`--include-untracked`, not `--all`). The shield only appends inside its own block; it never touches `.gitignore`, never deletes or moves a file
- **Default `.gitignore`** (`services/repoSetup.ts`, `noisePaths.DEFAULT_GITIGNORE`: `node_modules/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `.env`, `.env.*` with `!.env.example`, `.DS_Store`, `*.log`, `__pycache__/`, `.venv/`): a new project folder without `.git` (new or an existing folder full of files) gets `git init` → `.gitignore` if missing → README if missing → the first commit (so `node_modules` never enters it). An existing git repo without `.gitignore` gets **no file and no commit**; the same patterns go into the `.git/info/exclude` block (local, unversioned). A repo with its own `.gitignore` is left alone. `createGithubRepo` uses the same helper
- Deleting a task (`DELETE /api/tasks/:id`) first sets its children's `parentTaskId` to `NULL` in the same transaction (no migration, the FK rule is unchanged), then deletes it; each orphaned child gets a `task_updated`. Dependency edges go with the task as before
- **Stash detail** (`stashService.getStashDetail`, SHA-cached): `GET /api/projects/:id/stashes` entries carry `summary: { total, deps, build, lockOs, code, untracked }` and `safeToDrop` (no `code` file). `GET …/stashes/:ref/files` returns `codeFiles`, `lockOsFiles` and folded noise `groups` (`noiseRoot`, ≤200 sample paths); classification is `noisePaths.classifyPath` (`deps` | `build` | `lock_os` | `code`, anything unsure is `code`). `GET …/stashes/:ref/diff?path=` diffs one file of the stash (tracked: `<sha>^1 <sha>`; untracked: empty tree → `<sha>^3`; only paths listed in the stash, else `404 stash_file_not_found`). `POST …/stashes/:ref/restore-file` `{ path }` restores one file without waiting for the repo lock (`409 repo_busy`): the path must be clean (`409 worktree_dirty` + `files`), a file/folder clash is `409 stash_conflict` before anything is touched, a file deleted in the stash is `422 stash_file_deleted`; the index is left alone and the stash is never dropped
- **Image attachments** (`task_attachments(id, taskId, commentId, path, mime, bytes, width, height, name, pending, createdAt)`, additive migration `services/bakimMigration.ts`; `services/attachmentService.ts`): files live outside the repo in `<DATA_DIR>/attachments/<taskId>/<id>.<ext>` (mode 0600). `POST /api/tasks/:id/attachments[?pending=1&name=…]` takes the raw bytes (`Content-Type: image/*`, `express.raw` 10 MB on this route only): png/jpeg/webp/gif sniffed from the bytes (`415 attachment_type`, no SVG), at most 10 MB (`413 attachment_too_large`) and 8 per task counting drafts (`409 attachment_limit`), never while `doing` (`409 task_running`). `GET /api/attachments/:id` serves it (`nosniff`, `inline`, immutable cache); `DELETE /api/attachments/:id` (not while `doing`). A comment's images are uploaded first as drafts (`?pending=1`, invisible on the task, swept after 24 h) and linked by `POST /api/tasks/:id/comments { body, uiLang, attachmentIds }` in the same transaction that creates the comment, before its runner starts (`400 attachment_not_pending`). `Task.attachments` lists the non-draft images without paths. Deleting a task or project removes the folders. Agent access: every role call of the CEO, Analyst, Developer (Solo too), QA, the conflict resolver (+ its QA) and the comment runner gets `--add-dir <attachments dir>` and an `<attachments>` prompt section with absolute paths and an instruction to open each with `Read` (the comment runner also gets `<feedback_attachments>` for that comment's images); a role without `Read` gets it for that call. Without images every prompt is byte-for-byte the old one. The planner and task breakdown do not see images. Cost: an image is about `width × height / 750` tokens (≈1 600 max; the API downsizes larger ones) and is read again by every role call; 8 full-size images in a Software Team run with 2 QA rounds (6 calls) are ≈77k tokens, ≈$0.48 at the cache-write price
- `comments` table: `id, taskId, body, status (pending/running/done/error), agentLog, createdAt`
- Comment WS event: `comment_updated` — `{ type, taskId, payload: Comment }`
- Chain WS event: `chain_advanced` — `{ type, taskId, payload: { projectId, displayId, merged, started: [{ id, displayId }] } }`
