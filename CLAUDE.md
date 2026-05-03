# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Workflow

For non-trivial development work in this repo, use the **multi-model collaborative workflow** via the `/multi-workflow` skill instead of spinning up custom agent teams. The skill orchestrates Claude (lead) + Codex (backend authority) + Gemini (frontend authority) through Research → Ideation → Plan → Execute → Optimize → Review.

### When to Use What

**Coordinator handles it directly** (no skill, no team):
- Questions, explanations, research
- A few-line bug fix in a single file
- Documentation, config, memory updates
- One-off DB operations
- File moves / renames, small string or style fixes
- Clearly localized, single-domain changes

**Use `/multi-workflow <task description>`**:
- Work that touches multiple areas (frontend + backend, UI + DB, etc.)
- New feature / non-trivial refactor / architectural decision
- Changes that need coordination across 4+ files
- Whenever a second perspective (backend or frontend specialist) materially helps

Related skills (use directly when only one phase is needed):
- `/multi-plan <task>` — planning only, no code changes
- `/multi-execute` — execute an existing plan
- `/multi-backend <task>` — backend-focused full pipeline (Codex-led)
- `/multi-frontend <task>` — frontend-focused full pipeline (Gemini-led)

> **Note:** This guidance is for working *on this repo*. The runtime agents inside `core/src/agents/` (executor, commentRunner) are part of the ClauFlow product itself and are unrelated to this workflow.

## Command Cheatsheet

Quick reference for ECC skills used in this repo. Pick the smallest tool that fits the job.

### By Scenario

| Scenario | Primary | Alternative | Notes |
|----------|---------|-------------|-------|
| **Suggest new things** (discovery / "what could we add?") | `/prp-prd` | `/feature-dev` | `/prp-prd` is problem-first, hypothesis-driven; `/feature-dev` is single-feature guided |
| **Plan only** (no code yet) | `/plan` | `/multi-plan` | `/plan` is fast single-model; `/multi-plan` adds Codex+Gemini perspectives |
| **Frontend work** (UI/UX) | `/multi-frontend` | `/ccg:frontend` | Gemini-led full pipeline (research → exec → review) |
| **Backend work** (API / DB / algorithms) | `/multi-backend` | `/ccg:backend` | Codex-led full pipeline |
| **Cross-stack feature** (frontend + backend together) | `/multi-workflow` | — | Full pipeline when work spans both |
| **Execute an existing plan** | `/multi-execute` | — | Run output of `/plan` or `/multi-plan` |
| **Code review** | `/code-review` | `/review-pr <PR#>` | Local diff vs GitHub PR |
| **Security review** | `/security-review` | — | Auth, input handling, payments, secrets |
| **TDD feature/bugfix** | `/tdd-workflow` | — | Test-first workflow |
| **Build broken** | `/build-fix` | — | TS / lint / compile errors |
| **Smart commit** | `/commit` | `/prp-commit` | Conventional commits + smart file grouping |
| **Open a PR** | `/prp-pr` | — | Branch → PR with summary |
| **Dead code cleanup** | `/refactor-clean` | — | knip / depcheck / ts-prune sweep |
| **Raise test coverage** | `/test-coverage` | — | Fill gaps to hit 80% |

### Typical Flows

**Cross-stack feature (full ceremony):**
```
/prp-prd        → clarify what we're building
/multi-plan     → plan with multi-model perspectives
/multi-execute  → implement (or use /multi-workflow to do all-in-one)
/code-review    → review the diff
/security-review → if sensitive surfaces touched
/commit         → commit
/prp-pr         → open PR
```

**Small task shortcut:**
```
/plan → write code → /code-review → /commit
```

### Auto-routing Hint

For open-ended analysis or feature-suggestion prompts (e.g. "incele ve neler eklenebilir?"), prefer `/prp-prd` or `/feature-dev` over a freeform brainstorm — the skills produce structured, actionable output instead of an ad-hoc list.

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

# Lint (gui only)
cd gui && pnpm lint

# Build
cd core && npm run build
cd gui && pnpm build
```

## Core Data Flow

1. User drags a card from `todo → doing`
2. GUI sends `PATCH /api/tasks/:id` with `status: "doing"`
3. The core route handler kicks off the executor fire-and-forget
4. Executor: checkout → branch → `claude CLI` → commit → push → `gh pr create`
5. Each step broadcasts `agent_log` / `agent_status` / `task_updated` over WebSocket
6. The GUI's `useAgentSocket` hook receives events → the Zustand store updates
7. If there is no remote, the task moves directly to `done`; if a remote exists, it goes to `review`

## Comment Flow (Task Comments + AI)

1. The user adds a comment on a task in review
2. GUI calls `POST /api/tasks/:id/comments` (`{ body: "..." }`)
3. The backend stores the comment in the `comments` table and starts `commentRunner` fire-and-forget
4. The runner: checks out the task's `branch` → applies the comment via the `claude CLI` → commit → push (does not open a PR)
5. Each step broadcasts `comment_updated` over WebSocket
6. In the UI a spinner sits next to the comment → green check (done) / red error (error)

## Important Details

- `core/` uses `npm`, `gui/` uses `pnpm` — never cross them
- **Claude CLI invocation**: `-p <prompt>` must be the first argument; other flags (`--permission-mode`, etc.) come after
- `window.confirm` is not used — use `ConfirmDialog` (`gui/src/components/ui/ConfirmDialog.tsx`)
- Theme: Tailwind v4 light mode via `html.light { --color-zinc-* }` CSS variable override (not a class-name toggle)
- Language preference: `lang` Zustand state → `useTranslation()` hook
- `gh auth setup-git` is called on every executor run to refresh git credentials
- Dragging Review → Done triggers `gh pr merge --merge` (branch not deleted)
- Executor failure → task returns to `todo`, `agent.status: "error"`
- `comments` table: `id, taskId, body, status (pending/running/done/error), agentLog, createdAt`
- Comment WS event: `comment_updated` — `{ type, taskId, payload: Comment }`
