# ClauFlow

An AI-powered agentic kanban board. Drag a task to **DOING** — Claude writes the code, opens a PR, and moves it to **REVIEW**. Leave a comment on a task in review — Claude applies the fix to the existing branch.

```
TODO  →  DOING  →  REVIEW  →  DONE
          ↑ Claude codes here
```

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

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- `gh` CLI installed and authenticated (`gh auth login`)

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

## Project Structure

```
kanban/
├── core/               # Express + WebSocket backend
│   └── src/
│       ├── agents/
│       │   ├── executor.ts       # Task execution pipeline
│       │   └── commentRunner.ts  # Comment apply pipeline
│       ├── routes/               # REST: /api/tasks, /api/projects, /api/comments
│       ├── services/
│       │   ├── taskService.ts
│       │   ├── commentService.ts
│       │   ├── claudeService.ts  # Claude CLI wrapper (spawn)
│       │   ├── gitService.ts
│       │   └── wsService.ts
│       └── types/
└── gui/                # Next.js 15 frontend
    └── src/
        ├── app/
        │   ├── page.tsx          # Landing page
        │   ├── board/page.tsx    # Kanban board
        │   └── github/page.tsx   # PR list
        ├── components/
        │   ├── Board/            # Columns + dnd-kit
        │   ├── Card/             # TaskCard, TaskDetailDrawer, CommentsTab
        │   ├── Github/           # PRDetailDrawer
        │   ├── Modals/           # AddTaskModal, NewProjectModal
        │   └── Sidebar/          # ProjectSidebar
        ├── hooks/
        │   ├── useAgentSocket.ts # WebSocket → Zustand
        │   ├── useBoard.ts
        │   └── useTranslation.ts # TR/EN i18n
        ├── lib/
        │   ├── api.ts
        │   └── i18n/             # tr.ts, en.ts, types.ts
        └── store/
            └── boardStore.ts     # Zustand global state
```

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
