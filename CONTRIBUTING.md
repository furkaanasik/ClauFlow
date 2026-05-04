# Contributing to ClauFlow

Thanks for your interest. Here's everything you need to start contributing.

## Before you begin

- Read [`CLAUDE.md`](CLAUDE.md) — data flow, WS event shapes, project conventions
- Check [`ROADMAP.md`](ROADMAP.md) — pick an active item or open an issue before tackling something large
- For significant changes, **open an issue first** to align on approach

## Setup

```bash
# Backend (port 3001)
cd core && npm install && npm run dev

# Frontend (port 3000) — separate terminal
cd gui && pnpm install && pnpm dev
```

Create `gui/.env.local`:

```env
NEXT_PUBLIC_API_BASE=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

## Prerequisites

ClauFlow shells out to `claude` and `gh` at runtime. Both must be installed and authenticated:

```bash
claude --version   # Claude Code CLI
gh auth status     # GitHub CLI
```

## Making changes

- `core/` uses `npm`, `gui/` uses `pnpm` — never cross them
- UI confirmations use `ConfirmDialog`, never `window.confirm`
- Tailwind v4 theming via `html.light { --color-zinc-* }` CSS variable override
- Translations live in `gui/src/lib/i18n/en.ts` and `tr.ts` — add keys to both

## Before pushing

```bash
# Backend
cd core && npm run typecheck && npm test

# Frontend
cd gui && pnpm typecheck && pnpm lint
```

## Commit style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): short description
fix(scope): short description
docs(scope): short description
```

## Pull requests

- Keep the diff focused — one concern per PR
- Describe the *why*, not just the *what*
- Link the related issue if one exists

## Meta

ClauFlow is a kanban for Claude — you can use it on its own repo. Meta loops are encouraged.
