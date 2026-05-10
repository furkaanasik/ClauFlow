# Plan: GitHub Issues → Task Import

## Summary
Add an "Import from GitHub" button to the board toolbar that lists open issues from the active project's GitHub remote and bulk-creates selected issues as kanban tasks. Uses the existing `gh` CLI pattern already established in `core/src/routes/github.ts`. No new dependencies required.

## User Story
As a developer, I want to import open GitHub issues as kanban tasks with a single click, so that I can use ClauFlow without duplicating work I already track in GitHub.

## Problem → Solution
Current state: user must manually copy issue title/body into AddTaskModal. Desired state: click "Import Issues", check boxes, click "Import" — tasks created automatically.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 7

---

## UX Design

### Before
```
Board toolbar:  [ Search ]  [ + New Task ]

User workflow:
1. Open GitHub tab → copy issue title
2. Open AddTaskModal → paste → submit
   (repeat per issue)
```

### After
```
Board toolbar:  [ Search ]  [ ↓ Import Issues ]  [ + New Task ]

User workflow:
1. Click "Import Issues"
2. Modal shows list of open issues with checkboxes
3. Check desired issues → click "Import X Issues"
4. Toast: "3 tasks created" — modal closes
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Board toolbar | Only "+ New Task" | Adds "↓ Import Issues" button | shown only when project has a remote |
| Issue selection | n/a | Checkbox list, select-all toggle | filtered by label/search optional — NOT in scope |
| Task creation | Manual per-issue | Batch via single API call | title = issue title, description = issue body |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/routes/github.ts` | 1-100 | `execFileAsync`, `resolveProject`, `handleGhError` patterns to mirror exactly |
| P0 | `core/src/routes/tasks.ts` | 141-153 | `createTask` + `broadcastTaskCreated` pattern |
| P0 | `gui/src/lib/api.ts` | 563-580 | `githubApi` object pattern + `GHBASE` constant |
| P1 | `gui/src/components/Modals/AddTaskModal.tsx` | all | Modal structure, Field component, loading/error state pattern |
| P1 | `gui/src/lib/i18n/types.ts` | 29-52 | How to add new i18n section |
| P1 | `gui/src/components/Board/Board.tsx` | 1-80 | Where to add import button and modal |
| P2 | `core/src/services/taskService.ts` | 1-30 | `createTask` import |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: core/src/routes/github.ts:54-62
interface GhRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
}
// PascalCase interfaces, camelCase fields matching gh CLI JSON output
```

### ERROR_HANDLING
```typescript
// SOURCE: core/src/routes/github.ts:37-50
function handleGhError(err: unknown, res: Response, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not logged into") ||
    message.includes("GITHUB_TOKEN") ||
    message.includes("401") ||
    message.includes("gh auth")
  ) {
    res.status(401).json({ error: "GitHub kimlik dogrulamasi yapilmamis" });
    return;
  }
  console.error(`[github] ${context} error:`, message);
  res.status(500).json({ error: message });
}
```

### GH_CLI_PATTERN
```typescript
// SOURCE: core/src/routes/github.ts:68-99
const { stdout } = await execFileAsync(
  "gh",
  ["issue", "list", "--json", "number,title,body,labels,state", "--limit", "50", "--state", "open"],
  { cwd: project.repoPath },
);
const issues = JSON.parse(stdout) as GhIssue[];
```

### RESOLVE_PROJECT_PATTERN
```typescript
// SOURCE: core/src/routes/github.ts:20-35
const project = await resolveProject(req, res);
if (!project) return;
// Then use project.repoPath for gh CLI cwd
```

### BROADCAST_CREATE_PATTERN
```typescript
// SOURCE: core/src/routes/tasks.ts:141-153
const task = await createTask(parsed.data);
broadcastTaskCreated(task);
res.status(201).json({ task });
```

### FRONTEND_MODAL_PATTERN
```typescript
// SOURCE: gui/src/components/Modals/AddTaskModal.tsx:28-88
// - State: useState for each field + loading + error
// - useToast for success notification
// - useTranslation for all strings
// - useBoardStore for selectedProjectId + upsertTask
// - try/catch with setLoading(false) in finally
```

### GITHUB_API_OBJECT
```typescript
// SOURCE: gui/src/lib/api.ts:563-580
export const githubApi = {
  listPRs: (projectId: string): Promise<PRListItem[]> =>
    fetch(`${GHBASE}/github/prs?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => handle<PRListItem[]>(r)),
  // New methods appended to this same object
};
```

### I18N_PATTERN
```typescript
// SOURCE: gui/src/lib/i18n/types.ts:29-52
// 1. Add new key block to Translations interface in types.ts
// 2. Add matching block to tr.ts (Turkish)
// 3. Add matching block to en.ts (English)
// All three files must be updated together.
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/routes/github.ts` | UPDATE | Add `GET /github/issues` + `POST /github/issues/import` endpoints |
| `gui/src/lib/api.ts` | UPDATE | Add `githubApi.listIssues` + `githubApi.importIssues` |
| `gui/src/components/Modals/ImportIssuesModal.tsx` | CREATE | New modal component |
| `gui/src/components/Board/Board.tsx` | UPDATE | Add import button + mount ImportIssuesModal |
| `gui/src/lib/i18n/types.ts` | UPDATE | Add `importIssues` section to Translations interface |
| `gui/src/lib/i18n/tr.ts` | UPDATE | Turkish strings for `importIssues` |
| `gui/src/lib/i18n/en.ts` | UPDATE | English strings for `importIssues` |

## NOT Building
- Filtering issues by label or assignee (out of scope)
- Search within the issue list
- Syncing task status back to GitHub (separate roadmap item)
- Two-way sync / closing issues when task is done (separate roadmap item)
- Pagination beyond 50 issues (gh CLI `--limit 50` is sufficient)

---

## Step-by-Step Tasks

### Task 1: Backend — `GET /github/issues`

- **ACTION**: Add GET endpoint to `core/src/routes/github.ts`
- **IMPLEMENT**:
```typescript
interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string; color: string }[];
  state: string;
}

router.get("/issues", async (req: Request, res: Response) => {
  const project = await resolveProject(req, res);
  if (!project) return;

  if (!project.remote) {
    res.status(422).json({ error: "Bu proje bir GitHub remote'una bagli degil" });
    return;
  }

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "list", "--json", "number,title,body,labels,state", "--limit", "50", "--state", "open"],
      { cwd: project.repoPath },
    );
    const issues = JSON.parse(stdout) as GhIssue[];
    res.json({ issues });
  } catch (err: unknown) {
    handleGhError(err, res, "issue list");
  }
});
```
- **MIRROR**: `GH_CLI_PATTERN`, `RESOLVE_PROJECT_PATTERN`, `ERROR_HANDLING`
- **IMPORTS**: Already imported: `execFileAsync`, `resolveProject`, `handleGhError`, `Router`, `Request`, `Response`
- **GOTCHA**: `project.remote` check must come AFTER `resolveProject` succeeds. No-remote projects have no GitHub issues to fetch.
- **VALIDATE**: `cd core && curl -s "http://localhost:3001/github/issues?projectId=<id>" | jq .`

### Task 2: Backend — `POST /github/issues/import`

- **ACTION**: Add POST endpoint to `core/src/routes/github.ts` that creates tasks from selected issues
- **IMPLEMENT**:
```typescript
import { createTask } from "../services/taskService.js";
import { broadcastTaskCreated } from "../services/wsService.js";
import { z } from "zod";

const importIssuesSchema = z.object({
  projectId: z.string().min(1),
  issues: z.array(z.object({
    number: z.number(),
    title: z.string().min(1),
    body: z.string(),
  })).min(1),
});

router.post("/issues/import", async (req: Request, res: Response) => {
  const parsed = importIssuesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const { projectId, issues } = parsed.data;

  try {
    const created = await Promise.all(
      issues.map((issue) =>
        createTask({
          projectId,
          title: issue.title,
          description: issue.body,
        }).then((task) => { broadcastTaskCreated(task); return task; })
      )
    );
    res.status(201).json({ tasks: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
```
- **MIRROR**: `BROADCAST_CREATE_PATTERN`, `NAMING_CONVENTION`
- **IMPORTS**: Add `createTask` from `../services/taskService.js` and `broadcastTaskCreated` from `../services/wsService.js` and `z` from `"zod"` at top of `github.ts`
- **GOTCHA**: `createTask` is async — use `Promise.all`, not a sequential loop. If one fails, the whole batch fails — acceptable for v1.
- **VALIDATE**: `curl -s -X POST http://localhost:3001/github/issues/import -H "Content-Type: application/json" -d '{"projectId":"...","issues":[{"number":1,"title":"Test","body":""}]}' | jq .`

### Task 3: Frontend API — add `githubApi.listIssues` + `githubApi.importIssues`

- **ACTION**: Extend the `githubApi` object in `gui/src/lib/api.ts`
- **IMPLEMENT**:
```typescript
// Add interface near other GH interfaces (around line 540)
export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string; color: string }[];
  state: string;
}

// In githubApi object, append:
listIssues: (projectId: string): Promise<{ issues: GhIssue[] }> =>
  fetch(`${GHBASE}/github/issues?projectId=${encodeURIComponent(projectId)}`)
    .then((r) => handle<{ issues: GhIssue[] }>(r)),

importIssues: (
  projectId: string,
  issues: Pick<GhIssue, "number" | "title" | "body">[],
): Promise<{ tasks: Task[] }> =>
  fetch(`${GHBASE}/github/issues/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, issues }),
  }).then((r) => handle<{ tasks: Task[] }>(r)),
```
- **MIRROR**: `GITHUB_API_OBJECT`
- **IMPORTS**: `Task` is already imported at top of `api.ts`
- **GOTCHA**: Use `GHBASE` (not `BASE`) for `/github/*` routes — they live on the root, not `/api/`
- **VALIDATE**: TypeScript compile: `cd gui && pnpm typecheck`

### Task 4: i18n types + translations

- **ACTION**: Add `importIssues` block to all three i18n files
- **IMPLEMENT** — `gui/src/lib/i18n/types.ts` (inside `Translations` interface):
```typescript
importIssues: {
  buttonLabel: string;
  modalTitle: string;
  loading: string;
  loadError: string;
  noRemote: string;
  empty: string;
  selectAll: string;
  deselectAll: string;
  importButton: string;        // "Import X Issues"
  importing: string;
  successToast: string;        // "X tasks created"
  errorGeneric: string;
  issueNumber: string;         // "#42"
};
```
- **IMPLEMENT** — `gui/src/lib/i18n/en.ts`:
```typescript
importIssues: {
  buttonLabel: "Import Issues",
  modalTitle: "Import GitHub Issues",
  loading: "Loading issues...",
  loadError: "Failed to load issues",
  noRemote: "This project has no GitHub remote",
  empty: "No open issues found",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  importButton: (n: number) => `Import ${n} Issue${n !== 1 ? "s" : ""}`,
  importing: "Importing...",
  successToast: (n: number) => `${n} task${n !== 1 ? "s" : ""} created`,
  errorGeneric: "Import failed",
  issueNumber: "#",
},
```
- **IMPLEMENT** — `gui/src/lib/i18n/tr.ts`:
```typescript
importIssues: {
  buttonLabel: "Issue İçe Aktar",
  modalTitle: "GitHub Issue'larını İçe Aktar",
  loading: "Issue'lar yükleniyor...",
  loadError: "Issue'lar yüklenemedi",
  noRemote: "Bu projenin GitHub remote'u yok",
  empty: "Açık issue bulunamadı",
  selectAll: "Tümünü seç",
  deselectAll: "Tümünü kaldır",
  importButton: (n: number) => `${n} Issue Aktar`,
  importing: "Aktarılıyor...",
  successToast: (n: number) => `${n} görev oluşturuldu`,
  errorGeneric: "İçe aktarma başarısız",
  issueNumber: "#",
},
```
- **MIRROR**: `I18N_PATTERN`
- **GOTCHA**: `importButton` and `successToast` are functions that take a count — update `Translations` type to reflect `(n: number) => string` type (not `string`)
- **VALIDATE**: `cd gui && pnpm typecheck`

### Task 5: Create `ImportIssuesModal.tsx`

- **ACTION**: Create `gui/src/components/Modals/ImportIssuesModal.tsx`
- **IMPLEMENT**:
```typescript
"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { githubApi, type GhIssue } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";

interface ImportIssuesModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportIssuesModal({ open, onClose }: ImportIssuesModalProps) {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const upsertTask        = useBoardStore((s) => s.upsertTask);
  const toast             = useToast();
  const t                 = useTranslation();

  const [issues,   setIssues]   = useState<GhIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (!open || !selectedProjectId) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    githubApi.listIssues(selectedProjectId)
      .then((r) => setIssues(r.issues))
      .catch((err) => setError(err instanceof Error ? err.message : t.importIssues.loadError))
      .finally(() => setLoading(false));
  }, [open, selectedProjectId]);

  const allSelected = issues.length > 0 && selected.size === issues.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(issues.map((i) => i.number)));
  };

  const toggle = (number: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(number) ? next.delete(number) : next.add(number);
      return next;
    });
  };

  const handleImport = async () => {
    if (!selectedProjectId || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const toImport = issues.filter((i) => selected.has(i.number));
      const { tasks } = await githubApi.importIssues(selectedProjectId, toImport);
      tasks.forEach((task) => upsertTask(task));
      toast.success(t.importIssues.successToast(tasks.length));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.importIssues.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t.importIssues.modalTitle} size="lg">
      {loading && (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{t.importIssues.loading}</p>
      )}
      {!loading && error && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
          {error}
        </div>
      )}
      {!loading && !error && issues.length === 0 && (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{t.importIssues.empty}</p>
      )}
      {!loading && issues.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="self-start text-[11px] font-medium text-[var(--text-secondary)] underline underline-offset-2"
          >
            {allSelected ? t.importIssues.deselectAll : t.importIssues.selectAll}
          </button>
          <div className="flex max-h-[400px] flex-col gap-1 overflow-y-auto">
            {issues.map((issue) => (
              <label
                key={issue.number}
                className="flex cursor-pointer items-start gap-3 rounded border border-[var(--border)] px-3 py-2.5 hover:border-[var(--text-secondary)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(issue.number)}
                  onChange={() => toggle(issue.number)}
                  className="mt-0.5 accent-[var(--text-primary)]"
                />
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    <span className="text-[var(--text-muted)]">{t.importIssues.issueNumber}{issue.number}</span>
                    {" "}{issue.title}
                  </span>
                  {issue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {issue.labels.map((l) => (
                        <span
                          key={l.name}
                          className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                          style={{ background: `#${l.color}22`, color: `#${l.color}` }}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
          {error && (
            <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
              {error}
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost px-4 py-2 text-[12px] font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={selected.size === 0 || saving}
              className="btn-ink inline-flex items-center gap-2 px-5 py-2 text-[12px] font-medium disabled:opacity-50"
            >
              {saving ? t.importIssues.importing : t.importIssues.importButton(selected.size)}
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```
- **MIRROR**: `FRONTEND_MODAL_PATTERN`
- **IMPORTS**: `Modal`, `githubApi`, `GhIssue`, `useBoardStore`, `useToast`, `useTranslation`
- **GOTCHA**: `upsertTask` must be called for each created task so board updates without reload. Check that `useBoardStore` exposes `upsertTask`.
- **VALIDATE**: No TypeScript errors; modal renders in browser.

### Task 6: Wire into Board.tsx

- **ACTION**: Add import button and mount modal in `gui/src/components/Board/Board.tsx`
- **IMPLEMENT**:
  1. Import `ImportIssuesModal` at top
  2. Add `importOpen` state: `const [importOpen, setImportOpen] = useState(false);`
  3. Lookup selected project to check if it has a remote:
     ```typescript
     const projects = useBoardStore((s) => s.projects);
     const selectedProject = projects.find((p) => p.id === selectedProjectId);
     const hasRemote = Boolean(selectedProject?.remote);
     ```
  4. In the toolbar area (near the AddTask button), add:
     ```tsx
     {hasRemote && (
       <button
         type="button"
         onClick={() => setImportOpen(true)}
         className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium"
       >
         ↓ {t.importIssues.buttonLabel}
       </button>
     )}
     ```
  5. Mount modal (near AddTaskModal):
     ```tsx
     <ImportIssuesModal open={importOpen} onClose={() => setImportOpen(false)} />
     ```
- **MIRROR**: `FRONTEND_MODAL_PATTERN`
- **GOTCHA**: Button only shown when `hasRemote` is true — prevents confusing 422 error for projects with no GitHub remote. Check how `projects` is stored in boardStore before assuming it's there; if not, use `useBoardStore((s) => s.projects)` — that slice must exist.
- **VALIDATE**: Button appears for remote-connected projects; hidden for local-only projects.

---

## Testing Strategy

### Manual Validation Checklist
- [ ] Project with remote: "Import Issues" button visible in toolbar
- [ ] Project without remote: button hidden
- [ ] Modal opens, shows spinner while loading
- [ ] Issues list rendered with checkboxes, labels, issue numbers
- [ ] Select all / deselect all works
- [ ] Import with 0 selected: button disabled
- [ ] Import with 1+ selected: tasks appear in TODO column immediately (via upsertTask)
- [ ] Toast shows "X tasks created"
- [ ] Network error: error message shown inside modal (not crash)
- [ ] No GitHub auth: 401 shown as error in modal

### Edge Cases Checklist
- [ ] Project has 0 open issues → empty state message
- [ ] Issue body is empty string → task created with empty description (valid)
- [ ] Issue title > 255 chars → still creates (no truncation in backend schema)
- [ ] 50 issues returned (limit): all shown, no pagination needed
- [ ] Import already-imported issue → creates duplicate task (acceptable, user's responsibility)

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
EXPECT: No lint errors

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: Clean build

### Manual Validation
Start both services, open board, test checklist above.
```bash
cd core && npm run dev
cd gui && pnpm dev
```

---

## Acceptance Criteria
- [ ] "Import Issues" button in board toolbar (only when project has remote)
- [ ] Modal lists open GitHub issues with checkboxes and label badges
- [ ] Select-all / deselect-all toggle works
- [ ] Importing creates tasks in TODO column and broadcasts via WebSocket
- [ ] Success toast with count
- [ ] Errors shown inside modal, not as crash
- [ ] Button hidden for projects without remote
- [ ] No TypeScript errors, no lint errors, clean build
- [ ] i18n: both TR and EN strings provided

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `projects` not in boardStore | Medium | Button can't check `hasRemote` | Read boardStore shape before Task 6; use `getProject` API call as fallback |
| `importButton`/`successToast` as functions in i18n type | Low | TS error if types.ts uses `string` | Use `(n: number) => string` in Translations interface |
| gh CLI not authenticated | High (first run) | 401 from backend | Already handled by `handleGhError` → shown as error string in modal |
| Duplicate imports | Low | Extra tasks | Out of scope; user's responsibility |

## Notes
- The "Cancel" button inside the modal can remain hardcoded in English or use `t.importIssues.cancel` — add `cancel: string` to the i18n block if desired during implementation.
- Route order in `github.ts`: `GET /issues` must be declared BEFORE any catch-all routes. Current file has no catch-all, so order doesn't matter.
- `POST /github/issues/import` is mounted at `/github/issues/import` (no `projectId` in path, it's in the body for POST consistency with tasks router).
