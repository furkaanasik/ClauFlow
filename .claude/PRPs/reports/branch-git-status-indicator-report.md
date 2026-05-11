# Implementation Report: Branch & Git Status Indicator

## Summary
Added live git branch name + dirty/clean indicator to the project selector sidebar. Selected project fetches `GET /api/projects/:id/git-status` and displays `⎇ <branch> ●` below the project name. Polls every 30 s.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small | Small |
| Confidence | High | High |
| Files Changed | 6 (1 new, 5 edits) | 6 (1 new, 5 edits) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Add `GitStatus` type to gui types | ✅ Complete | |
| 2 | Add `GET /:id/git-status` route to core | ✅ Complete | |
| 3 | Add `getProjectGitStatus` to api client | ✅ Complete | |
| 4 | Add `gitStatusByProject` + `setProjectGitStatus` to board store | ✅ Complete | |
| 5 | Create `useGitStatus` hook | ✅ Complete | |
| 6 | Render branch indicator in ProjectSidebar | ✅ Complete | SSH remotes (`git@`) not linkified per plan risk note |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (core) | ✅ Pass | Zero errors |
| Static Analysis (gui) | ✅ Pass | Zero errors |
| Lint | ✅ Pass | Zero errors (pre-existing warnings only) |
| Build | N/A | Dev server smoke test sufficient |
| Integration | N/A | Manual |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `gui/src/types/index.ts` | UPDATED | Added `GitStatus` interface |
| `core/src/routes/projects.ts` | UPDATED | Added `GET /:id/git-status` route + `execFileSync` import |
| `gui/src/lib/api.ts` | UPDATED | Added `getProjectGitStatus`, imported `GitStatus` |
| `gui/src/store/boardStore.ts` | UPDATED | Added `gitStatusByProject` state + `setProjectGitStatus` action |
| `gui/src/hooks/useGitStatus.ts` | CREATED | Poll hook with cleanup |
| `gui/src/components/Sidebar/ProjectSidebar.tsx` | UPDATED | Renders branch row with coloured dot |

## Deviations from Plan
SSH remote URLs (`git@github.com:…`) are not linkified — plain text shown instead. The plan's risk section noted SSH urls won't make valid browser links, so the branch name renders as plain `<span>` for those cases.

## Issues Encountered
None.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
