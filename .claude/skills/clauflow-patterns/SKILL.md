---
name: clauflow-patterns
description: Coding patterns extracted from ClauFlow git history. Auto-loaded so Claude follows project conventions without being told each time.
version: 1.0.0
source: local-git-analysis
analyzed_commits: 106
generated: 2026-05-02
---

# ClauFlow Patterns

This skill captures the actual conventions used in this repo, derived from 106 commits across ~10 days of active development.

## Commit Conventions

Every commit follows **Conventional Commits** with a scope:

```
<type>(<scope>): <subject>
```

### Observed Types (frequency-ordered)

| Type | Used For |
|------|----------|
| `feat` | New user-visible functionality |
| `fix` | Bug fix |
| `docs` | Docs (incl. ROADMAP, README, CLAUDE.md, specs, plans) |
| `chore` | Maintenance, deps, settings, ignore rules |
| `refactor` | Internal restructuring without behavior change |
| `ui` | Pure visual / cosmetic UI tweaks (rare; prefer `feat(gui)`) |

### Observed Scopes (frequency-ordered)

`gui`, `core`, `claude-config`, `github-clone`, `roadmap`, `readme`, `claude`, `landing`, `db`, `skills`, `spec`, `plan`, `agents`

**Rule:** prefer an existing scope before inventing a new one. If the change spans multiple, pick the dominant one or omit the scope.

## Co-Change Rules (mandatory)

These files **must change together** — touching one without the others is almost always a bug:

### 1. i18n Triplet
```
gui/src/lib/i18n/tr.ts
gui/src/lib/i18n/en.ts
gui/src/lib/i18n/types.ts
```
- Add a key to `types.ts`, then mirror it in **both** `tr.ts` and `en.ts`
- 19/19/18 commits touched these together — single-file edits leak missing-translation bugs

### 2. CLAUDE.md ↔ core/CLAUDE.md
- The repo has two CLAUDE.md files (root + core/)
- When updating workflow guidance that applies to both, sync both

### 3. Board state changes
```
gui/src/components/Board/Board.tsx
gui/src/store/boardStore.ts
```
- UI behavior + Zustand state usually move in lockstep

### 4. New API endpoint
```
core/src/routes/<route>.ts        # define route
core/src/services/<service>.ts    # implementation
core/src/services/wsService.ts    # if it broadcasts
core/src/types/index.ts           # shared types
gui/src/lib/api.ts                # frontend client
gui/src/types/index.ts            # frontend types
```

### 5. New user-visible action
```
<component>.tsx                   # the UI
gui/src/lib/api.ts                # API call
gui/src/lib/i18n/{tr,en,types}.ts # translations
gui/src/store/boardStore.ts       # if state involved
```

## Architecture

```
ClauFlow/
├── core/                # Node backend (npm) — port 3001
│   └── src/
│       ├── agents/      # executor.ts, commentRunner.ts (product runtime, not dev tooling)
│       ├── routes/      # Express routes — projects.ts is the busiest (19 changes)
│       ├── services/    # taskService, commentService, gitService, claudeService, wsService
│       └── types/index.ts
└── gui/                 # Next.js 15 frontend (pnpm) — port 3000
    └── src/
        ├── app/         # Routes: /, /board, /github
        ├── components/  # Folder-per-domain: Auth, Board, Card, Github, Layout, Modals, Sidebar, Studio, ui
        ├── hooks/
        ├── lib/         # api.ts, i18n/, githubConstants.ts
        ├── store/       # boardStore.ts (Zustand global)
        └── types/
```

### File Naming
- React components: `PascalCase.tsx`
- Hooks: `useXxx.ts`
- Services / utilities: `camelCase.ts`
- Test files: `<file>.test.ts` (co-located)

### Package Managers (do not mix)
- `core/` → **npm** (`core/package-lock.json`)
- `gui/` → **pnpm** (`gui/pnpm-lock.yaml`)

## Workflows

### Adding a New Feature
1. Branch: `feature/<descriptive-slug>` (e.g. `feature/github-clone-frontend`, `feature/claude-config-1d-skill-manager`)
2. Multiple small commits with `feat(<scope>):` and `fix(<scope>):` as you iterate
3. Open PR (numbered `#N` in merge messages)
4. Merge to master via PR (16 PRs merged so far — never direct push for feature work)
5. Update `ROADMAP.md` to mark item done in a follow-up `docs(roadmap):` commit

### Multi-Phase Epic
Big features get sliced into phases (1A, 1B, 1C, 1D, 1E):
- Each phase = its own PR
- `docs(roadmap):` commit marks each phase done
- Final epic merge wraps it up

### ROADMAP Discipline
- `ROADMAP.md` is updated after almost every shipped feature (16 commits)
- Mark items done; promote next item to `#1`
- Drop completed items when the section gets crowded

### Bug Fixing
1. `fix(<scope>): <what was broken>` — single commit usually
2. Hotspot files (high-churn): `routes/projects.ts`, `boardStore.ts`, `lib/api.ts`, `TaskDetailDrawer.tsx`
3. After a fix, verify the i18n triplet wasn't desynced

## Testing Reality (gap vs CLAUDE.md target)

CLAUDE.md states **80% coverage** as the target, but actual state:
- Only 2 test files: `core/src/services/slug.test.ts`, `core/src/services/claudeService.test.ts`
- Frontend (`gui/`): **zero tests**
- This is a known gap, not a convention to copy

When adding tests, place co-located: `<filename>.test.ts` next to the file.

## Permissions / Settings
- `bypassPermissions` is on in committed `.claude/settings.json` — iterative commands don't prompt
- Personal overrides go in `.claude/settings.local.json` (gitignored)

## Related Skills (ECC)

For workflow assistance, prefer these ECC skills (see CLAUDE.md "Command Cheatsheet"):
- `/multi-workflow` — cross-stack feature
- `/multi-frontend`, `/multi-backend` — single-side full pipeline
- `/prp-prd`, `/feature-dev` — discovery / new feature ideation
- `/code-review`, `/security-review` — review gates
