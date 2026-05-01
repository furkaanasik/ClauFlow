# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Team

The agent team is available, but **do not spin up a team for every job** — the token cost of the team-create / spawn / shutdown chain outweighs the benefit on small tasks. The coordinator decides based on the size of the work first.

### Agent Roles

- **planner** → analyzes the request, breaks it into tasks, decides which agent does what
- **frontend** → all UI / Next.js changes under `gui/`
- **executor** → git branching, running the claude CLI, commit/push/PR
- **reviewer** → code review, type errors, bug checks

### When To Use a Team, When To Stay as Coordinator?

**The coordinator handles it directly** (no team):
- Questions, explanations, research (already an exception)
- A few-line bug fix in a single file
- Documentation, config, memory updates
- One-off data operations against the DB
- File moves / renames, small string or style fixes
- Clearly localized, single-domain changes

**Spin up a team** (TeamCreate → planner → relevant agents → reviewer → TeamDelete):
- Work that touches multiple areas (frontend + backend, UI + DB, etc.)
- New feature / non-trivial refactor / architectural decision
- Changes that need coordination across 4+ files
- Git/PR automations that require the executor (branch + claude CLI + PR flow)
- When the user explicitly says "set up a team", "make a plan", "send it to the reviewer"

When in doubt, lean small — spinning up a team is expensive, do not do it if it is not needed. If the coordinator finishes a change and notices it has grown beyond the **single file / few lines** threshold, it can hand off to a team from that point on.

The agent team feature is enabled via the committed `.claude/settings.json` so every clone picks it up automatically:
```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "permissions": { "defaultMode": "bypassPermissions" }
}
```
Personal overrides (extra plugins, per-user allow rules) belong in `.claude/settings.local.json`, which stays gitignored.

### Setting Up the Team (when a team has been decided on)

Stand up the team with **TeamCreate**:

```
TeamCreate({ team_name: "<feature-slug>", agent_type: "team-lead", description: "<short purpose>" })
```

When spawning agents, always pass `team_name` and `name`:

```
Agent({ subagent_type: "planner", name: "planner", team_name: "<feature-slug>", prompt: "..." })
```

Communicate with SendMessage using `to: "<name>"` — **only team-member agents are reachable; an agent spawned without a team is unreachable via SendMessage and the message is lost in the inbox.**

When the work is finished: send `{ type: "shutdown_request" }` to every agent, then close the team with `TeamDelete`.

Do not re-spawn an idle agent — continue with `SendMessage` (if the team is still up, the message wakes the agent).

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

## Architecture

```
kanban/
├── core/          # Express + WebSocket backend (Node.js / tsx)
│   ├── src/
│   │   ├── agents/
│   │   │   ├── executor.ts      # Git + claude CLI orchestrator
│   │   │   └── commentRunner.ts # Comment → branch checkout → claude CLI → commit/push
│   │   ├── routes/              # REST: /api/tasks, /api/projects, /api/auth, /api/tasks/:id/comments, /github/prs*
│   │   ├── services/
│   │   │   ├── taskService.ts    # SQLite CRUD (better-sqlite3, WAL mode)
│   │   │   ├── commentService.ts # comments table CRUD
│   │   │   ├── wsService.ts      # WebSocket broadcast helpers
│   │   │   ├── gitService.ts     # git/gh shell helpers
│   │   │   └── claudeService.ts  # claude CLI runner (spawn)
│   │   └── types/index.ts        # Shared types (Task, Project, WsMessage…)
│   ├── .claude/
│   │   ├── settings.json         # bypassPermissions — runs without prompts
│   │   └── agents/               # planner, frontend, backend, reviewer (for vibe coding)
│   ├── CLAUDE.md                 # core-specific agent team instructions
│   └── data/tasks.db             # SQLite database (tasks + projects + comments tables)
└── gui/           # Next.js 15 + Tailwind CSS 4 + dnd-kit frontend
    └── src/
        ├── app/
        │   ├── page.tsx           # Landing page (/)
        │   ├── board/page.tsx     # Kanban board (/board)
        │   ├── github/page.tsx    # GitHub PR list (/github?projectId=xxx)
        │   ├── icon.tsx           # Favicon (Next.js OG image)
        │   └── layout.tsx         # Root layout, metadata, theme init
        ├── components/
        │   ├── Board/             # Board.tsx, BoardColumn.tsx — dnd-kit
        │   ├── Card/              # TaskCard, TaskDetailDrawer, AgentBadge, CommentsTab
        │   ├── Github/            # PRDetailDrawer (full-screen modal, side-by-side diff)
        │   ├── Modals/            # AddTaskModal, NewProjectModal
        │   ├── Sidebar/           # ProjectSidebar (includes project search)
        │   ├── Layout/            # Header (logo, TR/EN toggle, theme, WS status, GitHub)
        │   ├── Auth/              # GithubConnectModal
        │   └── ui/                # Badge, ConfirmDialog, Modal, Toast
        ├── hooks/
        │   ├── useAgentSocket.ts  # WS connection + event dispatch
        │   ├── useBoard.ts        # Board load, optimistic update
        │   ├── useGithubAuth.ts   # GitHub connection status
        │   ├── useKeyboardShortcuts.ts
        │   ├── useToast.ts
        │   └── useTranslation.ts  # TR/EN language hook
        ├── lib/
        │   ├── api.ts             # fetch wrapper → NEXT_PUBLIC_API_BASE
        │   ├── githubConstants.ts
        │   └── i18n/
        │       ├── types.ts       # Translations interface
        │       ├── tr.ts          # Turkish translations
        │       └── en.ts          # English translations
        ├── store/
        │   └── boardStore.ts      # Zustand global state (tasks, projects, lang, theme…)
        └── types/
            └── index.ts
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

- The data layer is SQLite (`better-sqlite3`, WAL mode) — no write queue needed, transaction-safe
- Migration: an existing `tasks.json` is auto-imported on first launch and archived as `tasks.json.migrated`
- GitHub auth uses the `gh auth login` device flow (no custom OAuth app required); `gh auth setup-git` is called on every executor run to refresh git credentials
- Dragging Review → Done triggers `gh pr merge --merge` (the branch is not deleted)
- PRs can also be merged from the `/github` page — after a merge the task with the matching `prNumber` is automatically moved to `done`
- The agent log is shown as a live stream in the GUI (`TaskDetailDrawer`)
- If the executor fails, the task returns to `todo` and `agent.status: "error"` is set
- GUI environment variables: `gui/.env.local` → `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_WS_URL`
- `core/` uses `npm`, `gui/` uses `pnpm`
- Agent definitions live in `.claude/agents/` — each agent knows which skills it can use
- **Claude CLI invocation**: `-p <prompt>` must be the first argument; other flags (`--permission-mode`, etc.) come after
- `window.confirm` is not used — use the `ConfirmDialog` component (`gui/src/components/ui/ConfirmDialog.tsx`)
- Theme: in Tailwind v4, light mode is implemented via a `html.light { --color-zinc-* }` CSS variable override (not a class-name override)
- Language preference (TR/EN): kept in the `lang` Zustand state, synced to `localStorage` — read via the `useTranslation()` hook
- `comments` table: `id, taskId, body, status (pending/running/done/error), agentLog, createdAt`
- Comment WS event: `comment_updated` — `{ type, taskId, payload: Comment }`
- Routing: `/` landing page, `/board` kanban board, `/github` PR list

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
