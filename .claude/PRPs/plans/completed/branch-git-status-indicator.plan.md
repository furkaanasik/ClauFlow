# Plan: Branch & Git Status Indicator

## Summary
Add a live git branch name and dirty/clean indicator to the project selector sidebar. When a project is selected the frontend fetches `GET /api/projects/:id/git-status` and displays the current branch name + a colour-coded dirty dot next to the project name. Polls every 30 s so it stays fresh during task transitions.

## User Story
As a developer, I want to see which git branch is active (and whether there are uncommitted changes) directly in the project sidebar, so that I never have to switch to a terminal to check HEAD.

## Problem → Solution
Project entries only show name + repoPath. → Each project entry also shows `⎇ <branch>` below the name, with a small dot (amber = dirty, green = clean). Clicking the branch name opens the GitHub branch URL when a remote is configured.

## Metadata
- **Complexity**: Small
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 6 (1 new hook, 5 edits)

---

## UX Design

### Before
```
┌─────────────────────────────────┐
│ ▌ my-project                    │
│   /home/user/my-project         │
└─────────────────────────────────┘
```

### After
```
┌─────────────────────────────────┐
│ ▌ my-project                    │
│   ⎇ feat/new-ui  ●              │  ← green dot = clean, amber = dirty
│   /home/user/my-project         │
└─────────────────────────────────┘
```
Branch name is a link when remote URL is known.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Project list item | name + repoPath | name + branch row + repoPath | Branch row fetched async |
| Project selection | triggers task load | also triggers git status fetch | No UX delay — status loads in background |
| Branch name | static text | clickable link (if remote exists) | Opens `<remote_url>/tree/<branch>` |
| Dirty state | not shown | amber dot = dirty, green dot = clean | Only shown after first fetch |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `gui/src/components/Sidebar/ProjectSidebar.tsx` | 130–184 | Target render location; must follow existing badge pattern |
| P0 | `gui/src/store/boardStore.ts` | 1–119, 313–366 | State shape; how to add new record keyed by projectId |
| P0 | `gui/src/lib/api.ts` | 154–163 | API client pattern to mirror |
| P1 | `gui/src/types/index.ts` | 48–66 | Project + ProjectPatch types; do NOT pollute ProjectPatch |
| P1 | `core/src/routes/projects.ts` | 64–81 | Route pattern: async handler, errorMessage(err) |
| P2 | `core/src/types/index.ts` | 54–67 | Project interface (core side) |
| P2 | `gui/src/hooks/useAgentSocket.ts` | 130–145 | How socket messages update project state — reference only |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| git porcelain | N/A | `git status --porcelain` → non-empty = dirty. Use `--porcelain` not `--short` for reliable scripting. |
| execFileSync | Node built-in | `execFileSync("git", [...], { encoding: "utf8", cwd })` — throws on non-zero exit; wrap in try/catch |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: gui/src/store/boardStore.ts:27-37
cloneStatus: Record<string, { status: CloneStatus; message: string }>;
skillProgress: Record<string, { status: SkillInstallStatus; message?: string }>;
ciIterations: Record<string, { iteration: number; maxIterations: number }>;
// → ephemeral per-project state uses Record<projectId, Payload> in store
```

### STORE_ACTION
```typescript
// SOURCE: gui/src/store/boardStore.ts:359-366
updateProjectPlanningStatus: (projectId, status, error) =>
  set((state) => ({
    projects: state.projects.map((p) =>
      p.id === projectId
        ? { ...p, planningStatus: status, planningError: error ?? null }
        : p,
    ),
  })),
// → small targeted setter, no full project replace
```

### API_CLIENT
```typescript
// SOURCE: gui/src/lib/api.ts:160-163
getProject: (id: string): Promise<Project> =>
  fetch(`${BASE}/projects/${id}`, { cache: "no-store" })
    .then((r) => handle<{ project: Project }>(r))
    .then((d) => d.project),
// → fetch + handle<ResponseShape> + extract field
```

### ROUTE_HANDLER
```typescript
// SOURCE: core/src/routes/projects.ts:73-81
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});
// → async, try/catch, errorMessage(err) for 500s
```

### SIDEBAR_BADGE
```tsx
// SOURCE: gui/src/components/Sidebar/ProjectSidebar.tsx:161-171
{isPlanning && (
  <span title={t.sidebar.plannerRunning} className="shrink-0">
    <Spinner />
  </span>
)}
{isPlannerError && (
  <span
    title={`...`}
    className="h-1.5 w-1.5 shrink-0 bg-[var(--status-error)]"
  />
)}
// → small inline badge/dot appended after project name
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/routes/projects.ts` | UPDATE | Add `GET /:id/git-status` endpoint |
| `gui/src/types/index.ts` | UPDATE | Add `GitStatus` interface |
| `gui/src/lib/api.ts` | UPDATE | Add `getProjectGitStatus()` |
| `gui/src/store/boardStore.ts` | UPDATE | Add `gitStatusByProject` record + `setProjectGitStatus` action |
| `gui/src/hooks/useGitStatus.ts` | CREATE | Hook: fetch on project select, poll every 30 s |
| `gui/src/components/Sidebar/ProjectSidebar.tsx` | UPDATE | Render branch row in each project entry |

## NOT Building
- WebSocket push for git status (pull polling is sufficient; avoids new WsMessage type)
- Persisting git status to DB (ephemeral; computed on demand)
- Branch switching UI
- Full git log / commit history display
- Dirty file list

---

## Step-by-Step Tasks

### Task 1: Add `GitStatus` type to gui types
- **ACTION**: Add `GitStatus` interface to `gui/src/types/index.ts`
- **IMPLEMENT**:
  ```typescript
  export interface GitStatus {
    branch: string | null;
    isDirty: boolean;
  }
  ```
  Place after the `Project` interface (after line 62).
- **MIRROR**: Interface naming convention from same file
- **IMPORTS**: None
- **GOTCHA**: Do NOT add to `ProjectPatch` — git status is not a PATCH-able field
- **VALIDATE**: `cd gui && pnpm typecheck` — zero errors

### Task 2: Add `GET /:id/git-status` route to core
- **ACTION**: Add new route handler in `core/src/routes/projects.ts`
- **IMPLEMENT**: Add before the `export default router` line:
  ```typescript
  import { execFileSync } from "node:child_process";

  router.get("/:id/git-status", async (req: Request, res: Response) => {
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });

      const cwd = project.repoPath;
      try {
        execFileSync("git", ["-C", cwd, "rev-parse", "--git-dir"], { stdio: "ignore" });
        const branch = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
          encoding: "utf8",
        }).trim();
        const porcelain = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
          encoding: "utf8",
        });
        const isDirty = porcelain.trim().length > 0;
        res.json({ branch, isDirty });
      } catch {
        res.json({ branch: null, isDirty: false });
      }
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });
  ```
- **MIRROR**: `ROUTE_HANDLER` pattern — async, try/catch, `errorMessage(err)`
- **IMPORTS**: `import { execFileSync } from "node:child_process";` at top of file (check if already imported first)
- **GOTCHA**: Inner try/catch catches `execFileSync` throws when `repoPath` is not a git repo — must return `{ branch: null, isDirty: false }` not 500
- **VALIDATE**: `curl http://localhost:3001/api/projects/<id>/git-status` returns `{ "branch": "master", "isDirty": false }`

### Task 3: Add `getProjectGitStatus` to api client
- **ACTION**: Add method to the `api` object in `gui/src/lib/api.ts`
- **IMPLEMENT**: After `getProject` (after line 163):
  ```typescript
  getProjectGitStatus: (id: string): Promise<GitStatus> =>
    fetch(`${BASE}/projects/${id}/git-status`, { cache: "no-store" })
      .then((r) => handle<GitStatus>(r)),
  ```
- **MIRROR**: `API_CLIENT` pattern from same file
- **IMPORTS**: Add `GitStatus` to the import from `@/types` at line 1
- **GOTCHA**: `GitStatus` must be imported; the file already imports from `@/types`
- **VALIDATE**: TypeScript accepts it — `pnpm typecheck`

### Task 4: Add `gitStatusByProject` state + `setProjectGitStatus` to board store
- **ACTION**: Update `boardStore.ts`
- **IMPLEMENT** (3 spots):
  
  **A) In the `BoardState` interface** (after `budgetExceeded` line ~37):
  ```typescript
  gitStatusByProject: Record<string, GitStatus>;
  setProjectGitStatus: (projectId: string, status: GitStatus) => void;
  ```
  
  **B) In initial state** (after `budgetExceeded: {}` line ~141):
  ```typescript
  gitStatusByProject: {},
  ```
  
  **C) Implementation** (after `setBudgetExceeded` action):
  ```typescript
  setProjectGitStatus: (projectId, status) =>
    set((state) => ({
      gitStatusByProject: { ...state.gitStatusByProject, [projectId]: status },
    })),
  ```
- **MIRROR**: `NAMING_CONVENTION` (Record<projectId, Payload>), `STORE_ACTION` pattern
- **IMPORTS**: Add `GitStatus` to the import from `@/types` at line 2
- **GOTCHA**: Record keyed by `projectId` string (not taskId) — follow `cloneStatus` shape
- **VALIDATE**: `pnpm typecheck`

### Task 5: Create `useGitStatus` hook
- **ACTION**: Create `gui/src/hooks/useGitStatus.ts`
- **IMPLEMENT**:
  ```typescript
  import { useEffect } from "react";
  import { api } from "@/lib/api";
  import { useBoardStore } from "@/store/boardStore";

  const POLL_INTERVAL_MS = 30_000;

  export function useGitStatus(projectId: string | null) {
    const setProjectGitStatus = useBoardStore((s) => s.setProjectGitStatus);

    useEffect(() => {
      if (!projectId) return;

      let cancelled = false;

      async function fetch() {
        try {
          const status = await api.getProjectGitStatus(projectId!);
          if (!cancelled) setProjectGitStatus(projectId!, status);
        } catch {
          // non-git dirs return { branch: null, isDirty: false } from server
          // network errors are silently ignored
        }
      }

      fetch();
      const timer = setInterval(fetch, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [projectId, setProjectGitStatus]);
  }
  ```
- **MIRROR**: `useEffect` cleanup pattern from other hooks in codebase
- **IMPORTS**: As shown above
- **GOTCHA**: `cancelled` flag prevents state updates after unmount; `setProjectGitStatus` is stable (Zustand selectors are referentially stable for primitives)
- **VALIDATE**: Hook compiles; `pnpm typecheck`

### Task 6: Render branch indicator in `ProjectSidebar`
- **ACTION**: Update `ProjectSidebar.tsx` to call hook and render branch row
- **IMPLEMENT**:

  **A) Call hook** — add near the top of the component (after existing `const` declarations):
  ```tsx
  import { useGitStatus } from "@/hooks/useGitStatus";
  // ...
  const gitStatusByProject = useBoardStore((s) => s.gitStatusByProject);
  useGitStatus(selectedProjectId);
  ```

  **B) Inside the project map** (after `const isPlannerError` line ~133), add:
  ```tsx
  const gitStatus = gitStatusByProject[p.id];
  ```

  **C) In the JSX**, insert branch row between the name span and the repoPath span (after line 172, before the `<span className="truncate font-mono...">` for repoPath):
  ```tsx
  {gitStatus?.branch && (
    <span className="flex items-center gap-1 font-mono text-[11px] text-[var(--text-faint)]">
      <span aria-hidden>⎇</span>
      {p.remote ? (
        <a
          href={`${p.remote.replace(/\.git$/, "")}/tree/${gitStatus.branch}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hover:text-[var(--text-secondary)] hover:underline"
        >
          {gitStatus.branch}
        </a>
      ) : (
        <span>{gitStatus.branch}</span>
      )}
      <span
        aria-label={gitStatus.isDirty ? "dirty" : "clean"}
        className={`h-1.5 w-1.5 rounded-full ${
          gitStatus.isDirty
            ? "bg-amber-400"
            : "bg-green-500"
        }`}
      />
    </span>
  )}
  ```
- **MIRROR**: `SIDEBAR_BADGE` pattern; Tailwind CSS variable colour pattern from same file
- **IMPORTS**: `useGitStatus` from `@/hooks/useGitStatus`; `useBoardStore` already imported
- **GOTCHA**: `e.stopPropagation()` on anchor click prevents triggering project selection; the `⎇` symbol (U+2387) is the git branch icon used in many terminals
- **VALIDATE**: Start gui dev server, open sidebar — branch name appears below project name with coloured dot

---

## Testing Strategy

### Manual Tests
| Test | Steps | Expected |
|---|---|---|
| Clean repo | Select a project on a clean branch | Shows `⎇ main ●` (green dot) |
| Dirty repo | Make an uncommitted change, select project | Shows `⎇ main ●` (amber dot) |
| Non-git dir | Add a project pointing to a non-git path | Branch row not shown (graceful skip) |
| Remote link | Project with GitHub remote, click branch name | Opens GitHub `/tree/<branch>` in new tab |
| No remote | Project without remote, hover branch | No link, plain text |
| Poll update | On branch `feat/x`, create commit, wait 30s | Branch name updates |

### Edge Cases Checklist
- [ ] `repoPath` does not exist on disk → 500 from inner `execFileSync`, caught, returns `{ branch: null, isDirty: false }`
- [ ] Detached HEAD state → `git rev-parse --abbrev-ref HEAD` returns `HEAD` — display as-is
- [ ] Network error from frontend poll → silently ignored, last known status stays
- [ ] Project with no selected project → hook skips (early return on `!projectId`)
- [ ] Remote URL ends in `.git` → stripped before constructing tree URL

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: Zero errors

### Dev Server Smoke Test
```bash
cd core && npm run dev
cd gui && pnpm dev
```
EXPECT: Sidebar shows branch name + dirty dot for any project that is a git repo

---

## Acceptance Criteria
- [ ] Branch name visible in sidebar for every git-backed project
- [ ] Dirty indicator (amber = uncommitted changes, green = clean) accurate
- [ ] Non-git project paths show nothing (no error, no crash)
- [ ] Branch name is a link when project has a `remote` URL
- [ ] Status refreshes without page reload (poll or task transition)
- [ ] `pnpm typecheck` and `npm run typecheck` both pass
- [ ] `pnpm lint` passes

## Completion Checklist
- [ ] `GitStatus` type added to `gui/src/types/index.ts`
- [ ] `GET /api/projects/:id/git-status` route works and handles non-git paths gracefully
- [ ] `api.getProjectGitStatus` added to `gui/src/lib/api.ts`
- [ ] `gitStatusByProject` state + `setProjectGitStatus` in board store
- [ ] `useGitStatus` hook created with cleanup
- [ ] Sidebar renders branch row without breaking existing layout
- [ ] No console errors in browser

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `execFileSync` blocks event loop briefly | Low | Low | Commands are fast (< 50 ms on local disk); acceptable |
| Very large repos make `git status` slow | Low | Medium | 30 s poll — user won't notice; add 2 s timeout if needed |
| Remote URL format varies (SSH vs HTTPS) | Medium | Low | `.replace(/\.git$/, "")` normalises most cases; SSH urls won't make valid browser links — just don't linkify `git@` URLs |

## Notes
- No DB migration needed — git status is always computed live
- `core/` uses `npm`, `gui/` uses `pnpm` — never cross them
- The `⎇` character (U+2387) renders as a branch fork in most monospace fonts; fallback graceful in all browsers
