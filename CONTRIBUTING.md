# Contributing to ClauFlow

Thanks for your interest. Here's everything you need to start contributing.

## Before you begin

- Read [`CLAUDE.md`](CLAUDE.md) — data flow, WS event shapes, project conventions
- Check [GitHub Issues](https://github.com/furkaanasik/ClauFlow/issues), which is the roadmap: pick an open item or open an issue before tackling something large
- For significant changes, **open an issue first** to align on approach

## Setup

```bash
# Backend (port 3001)
cd core && npm install && npm run dev

# Frontend (port 3000) — separate terminal
cd gui && pnpm install && pnpm dev
```

The defaults work without an env file. To point the GUI elsewhere, create `gui/.env.local`:

```env
NEXT_PUBLIC_API_BASE=http://localhost:3001/api
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
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
- Theming: `cream` is the default (`:root` tokens in `gui/src/app/globals.css`), `night` adds the `html.night` class; use the tokens and `components/ui/` primitives described in [`DESIGN.md`](DESIGN.md), never raw hex colours
- Translations live in `gui/src/lib/i18n/en.ts` and `tr.ts`, typed by `types.ts` — add keys to all three
- `core/` has vitest tests (a fake `claude` CLI lives in `core/src/agents/__fixtures__/`); add or update tests with core changes

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
