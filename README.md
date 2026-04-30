# ClauFlow

An AI-powered agentic kanban board. Drag a task to **DOING** — Claude writes the code, opens a PR, and moves it to **REVIEW**. Leave a comment on a task in review — Claude applies the fix to the existing branch.

```
TODO  →  DOING  →  REVIEW  →  DONE
          ↑ Claude codes here
```

---

## Overview

ClauFlow turns a kanban board into an autonomous development pipeline. Instead of writing code yourself, you describe the work as a task — moving the card across columns drives a real engineering workflow behind the scenes:

- **TODO → DOING** spawns the Claude Code CLI in a fresh feature branch, lets it implement the change, then commits, pushes, and opens a pull request.
- **REVIEW** is where humans take over: read the diff in the built-in side-by-side viewer, leave comments, and Claude re-runs against the same branch to apply the requested changes.
- **DONE** auto-merges the PR via `gh pr merge`.

Every step streams over WebSocket, so the agent's logs, status transitions, and PR updates appear live in the UI. Multiple projects, GitHub authentication, TR/EN i18n, dark/light theme, and a SQLite-backed task store are included out of the box.

## Features

- **Drag-driven AI execution** — column transitions trigger real git/Claude/gh pipelines, no manual scripts
- **Branch-aware comment loop** — review feedback gets applied as new commits on the same PR branch
- **Live agent logs** — WebSocket stream of every step: checkout, prompt, commit, push, PR
- **Built-in PR viewer** — full-screen drawer with side-by-side diff, file tree, and merge button
- **Multi-project support** — sidebar with search; each project has its own board, repo, and tasks
- **GitHub via `gh` device flow** — no custom OAuth app to register
- **i18n + theming** — TR/EN toggle and dark/light mode, both persisted in `localStorage`
- **SQLite (WAL mode)** — transaction-safe storage, automatic migration from the legacy `tasks.json`

---

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | Next.js 15, Tailwind CSS 4, Zustand, dnd-kit |
| Backend  | Node.js, Express, WebSocket, SQLite (better-sqlite3) |
| AI       | Claude Code CLI (`claude`) |
| VCS      | Git + GitHub CLI (`gh`) |

---

## Getting Started

### Prerequisites

ClauFlow shells out to two CLIs at runtime — both must be installed and authenticated **before** you start the backend:

| CLI | Why it's needed | Install | Auth |
|-----|-----------------|---------|------|
| **Claude Code** (`claude`) | Runs the actual code generation in each executor / comment task | [docs.claude.com/claude-code](https://docs.claude.com/en/docs/claude-code/overview) | `claude` (first run prompts login) |
| **GitHub CLI** (`gh`) | Clones repos, sets up git credentials, opens & merges PRs | macOS: `brew install gh` · Arch/CachyOS: `sudo pacman -S github-cli` · Debian/Ubuntu: see [cli.github.com](https://cli.github.com) | `gh auth login` then `gh auth setup-git` |

Plus:
- **Node.js 18+** and **pnpm** (frontend uses pnpm, backend uses npm)
- **Git** with a configured identity (`git config --global user.name` / `user.email`)

Verify everything is wired up:

```bash
claude --version
gh auth status
node --version
```

### Install & Run

```bash
# Backend (port 3001)
cd core
npm install
npm run dev

# Frontend (port 3000)
cd gui
pnpm install
pnpm dev
```

### Environment

Create `gui/.env.local`:

```env
NEXT_PUBLIC_API_BASE=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

---

## How It Works

### Task Execution Flow

1. User drags a task from **TODO → DOING**
2. Backend fires the executor (non-blocking)
3. Executor:
   - Checks out the base branch, creates `feature/issue-<id>`
   - Runs `claude -p "<task analysis>" --permission-mode bypassPermissions`
   - Commits, pushes, opens a PR via `gh pr create`
4. Every step broadcasts over WebSocket → live log in the UI
5. If no remote: task goes straight to **DONE**. If remote exists: task moves to **REVIEW**

### Comment Runner Flow

1. User adds a comment on a task in **REVIEW**
2. Backend saves the comment, fires the comment runner
3. Runner checks out the task's existing branch, runs Claude with the comment as feedback
4. Commits and pushes (no new PR opened)
5. Comment status updates live: spinner → ✓ done / ✗ error

### Agent Team

The project uses a CLAUDE.md-defined agent team for its own development:

| Agent    | Role |
|----------|------|
| planner  | Breaks requests into tasks |
| frontend | Next.js / React / UI changes |
| executor | Git, Claude CLI orchestration |
| reviewer | PR review, merge |

---

## Repository Layout

Two packages, run independently:

- [`core/`](core/) — Express + WebSocket backend (Node.js, `npm`, port `3001`). SQLite store, executor / comment-runner pipelines, REST + WS routes.
- [`gui/`](gui/) — Next.js 15 frontend (`pnpm`, port `3000`). Kanban board, PR viewer, project sidebar.

For a deeper tour of the architecture, data flow, and conventions, see [`CLAUDE.md`](CLAUDE.md) — it's the source of truth for both human contributors and AI agents working on the repo.

---

## Contributing

PRs welcome. A few notes before you open one:

- **Read [`CLAUDE.md`](CLAUDE.md) first** — it documents the data flow, WS event shape, and project conventions (e.g. no `window.confirm`, Tailwind v4 theming, comment runner contract).
- **Roadmap** lives in [`ROADMAP.md`](ROADMAP.md). Pick something marked active or open an issue before tackling a larger change.
- Run `npm run typecheck` (in `core/`) and `pnpm typecheck && pnpm lint` (in `gui/`) before pushing.
- Keep commits scoped and the PR description focused on the *why*.
- ClauFlow itself is a kanban for Claude — feel free to use it on its own repo. Meta loops are encouraged.

---

## Scripts

```bash
# Backend
npm run dev        # tsx watch
npm run build      # tsc
npm run typecheck  # tsc --noEmit

# Frontend
pnpm dev           # next dev
pnpm build         # next build
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
```

---

## Notes

- SQLite runs in WAL mode — no write queue needed, transaction-safe
- GitHub auth uses `gh` device flow — no custom OAuth app required
- `gh auth setup-git` is called before every executor run to keep credentials fresh
- Language preference (TR/EN) persists in `localStorage`
- Theme preference (dark/light) persists in `localStorage`
