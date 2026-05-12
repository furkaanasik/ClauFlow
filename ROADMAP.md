# ROADMAP

## Completed

- ✅ **Project Claude Config + Agent Studio** — turns ClauFlow into a "Claude project control panel". Shipped in five phases:
  - ✅ Phase 1A — Claude Config tab + `CLAUDE.md` editor (split editor, live preview, save + push)
  - ✅ Phase 1B — Agents CRUD (`.claude/agents/*.md` editor, model picker, auto-bootstraps `.claude/settings.json`)
  - ✅ Phase 1C — Prereq onboarding (banner that checks `claude` / `git` / `gh` versions, copy-to-clipboard install commands)
  - ✅ Phase 1D — Skill Manager (Installed / Registry / Marketplaces backed by `claude plugin` CLI passthrough — real plugins discoverable by `claude /skills`)
  - ✅ Phase 1E — Agent Studio (node-graph canvas with @xyflow/react, drag-and-drop skill assignment, AI-generated agents from prompt, topology synced to `_graph.json` + Mermaid block in `CLAUDE.md`)
- ✅ Issue ID convention (displayId like `KPI-3`)
- ✅ Structured tool call streaming (stream-json + collapsible tool log)
- ✅ Token + cost observability
- ✅ Task deletion
- ✅ Frontend scale / density (#12)
- ✅ Full UI refresh — Fraunces typography, modern landing (live mini-kanban demo), simplification across every inner page
- ✅ Modern diff view (PR detail) — per-file collapsible block, sticky header, **Mark viewed** toggle + auto-scroll, sidebar tick mirror, lime/coral palette, hunk header humanized as `↳ line N + context`
- ✅ Theme picker on the landing page — sun/moon toggle in the `/` header, synced with the existing `html.light` + `localStorage` plumbing
- ✅ GitHub repos in the sidebar + click-to-clone — listing via `gh repo list`, local/remote split, two-column clone modal (left: form, right: scrollable repo info + GitHub link), WS progress, search filters the GitHub repo list too, the cloned repo becomes the active project automatically, partial-clone cleanup on failure
- ✅ **Studio skill injection** — `buildNodePrompt` now parses `## Available Skills` table in agent body, reads each skill's `~/.claude/skills/<id>/SKILL.md`, and appends full content as inline blocks. Path traversal guard included. Skills with missing files silently skipped.
- ✅ **Studio main node** — Permanent `main` entry-point node on canvas. Backend auto-creates `main.md` on `GET /agents` if missing. Frontend shows amber/gold border + "entry" badge, locked to `{ x: 20, y: 20 }`, drag disabled, delete guarded via keyboard/canvas and hidden in AgentEditDrawer.
- ✅ **Streaming token events (mid-run budget enforcement)** — `onUsage` callback fires per assistant turn; cost accumulated mid-run and compared against effective budget. `controller.abort()` called before the run finishes. DB write happens before abort check so spend is always recorded. `onClaudeResult` kept as fallback for CLI versions that don't emit turn-level usage.
- ✅ **"Nothing" kanban column** — When Claude runs successfully (exit 0) but makes zero new commits, task moves to a dedicated `nothing` column instead of `done`. Slate-grey styling, terminal state (no DnD transitions), numeral "06". Agent text buffer auto-saved as a comment so the explanation is visible on the task.
- ✅ **Auto-comment from agent output** — After executor run, if the text buffer contains `## Code Review Report`, it is saved as a static `done`-status comment (no commentRunner triggered, `comment_updated` broadcast). Same auto-comment fires on `nothing` transitions with the full agent response.
- ✅ **Subagent calls in Flow tab** — When the main agent invokes the `Agent` tool, a `NodeRun` with `nodeType: "subagent"` is created and broadcast via `node_started`. On completion the tool result is split into log lines and persisted as `outputArtifact.logLines`. MiniDagView renders subagent nodes with accent-coloured `subagent_type` label and description subtitle.
- ✅ **Collapsible board columns** — CI and Nothing collapsed by default (narrow 40 px strip, vertical title, task count). Click to expand. State persisted in `localStorage`. Board layout switched from CSS grid to flex so collapsed columns take minimal width. Collapse button added to each column header.
- ✅ **Markdown rendering in comments** — `done`-status comments that contain markdown markers are rendered via `react-markdown` with project-styled prose (headers, code blocks, lists, blockquotes). Plain-text comments keep `whitespace-pre-wrap` behaviour.
- ✅ **PR already-exists handling** — `createPr` now detects the "a pull request for branch … already exists" error from `gh pr create`, extracts the existing PR URL from stderr, and returns it as a success instead of failing the executor run.
- ✅ **Docker distribution** — `docker.yml` GitHub Actions workflow: build multi-arch image (amd64 + arm64) on every `v*.*.*` tag, push to GitHub Container Registry (`ghcr.io/furkaanasik/clauflow`). `docker-compose.yml` at repo root: core + gui services, named volume for SQLite persistence. `docker compose up` → running ClauFlow, no Node install needed.
- ✅ **GitHub Issues ↔ Task sync** — Import open issues from a repo into the kanban with a single click (board toolbar → "Import Issues", checkbox list, bulk create). Create new tasks as GitHub issues via checkbox in AddTaskModal; auto-adds to GitHub Projects board if one exists. Projects without a remote show a disabled checkbox with a configure link that opens project settings.
- ✅ **PR auto-review** — When a task reaches the REVIEW column (directly or via CI pass), Claude automatically runs a code review pass on the PR diff and posts the result as a comment on the task. Comment shows "running" spinner while Claude works, then renders full markdown review with Summary / Issues / Suggestions / Verdict.
- ✅ **Branch & git status indicator** — Show the active branch name (and optionally dirty/clean state) in the kanban header or project selector. When a project is selected, run `git branch --show-current` (+ `git status --short`) in the background and display the result next to the project name. Updates on task transitions so the branch always reflects the current HEAD. Nice-to-have: clickable to open the GitHub branch link.
- ✅ **Subtask linking** — After "Break down task" creates subtasks, link them back to the parent task so the relationship is visible in the drawer. `parentTaskId` field added to task schema; "Subtasks" section in drawer shows children; subtask detail drawer shows parent link for bidirectional navigation.
- ✅ **Notification system** — Browser Notification API (permission requested lazily) + optional webhook POST (Discord / Slack / custom) fire on agent `done` or `error`. Bell icon in header opens settings popover; config persists in localStorage.

---

## Planned

- 🗓 **Claude model selector per-task** — Choose which model runs for each task (Haiku: fast/cheap, Sonnet: balanced, Opus: deep work). The executor currently uses a hardcoded model; add a `model` field to the task schema and pass it through to the executor.

- 🗓 **Task dependencies** — "Don't start this until that task is done" links. `dependsOn` relationship between tasks; dependent tasks automatically wait when moved to DOING, and are released when the dependency reaches DONE. Should integrate with the project planner: ordering between tasks generated from a prompt should be modeled as dependencies.

- 🗓 **Rollback button** — Revert a task in the DONE column with a single click: revert the branch via `gh pr revert` or `git revert` and close the PR. Currently manual git work.

- 🗓 **GitHub Issues two-way sync** — When a task moves to DONE, close the linked GitHub issue. Add `issueNumber` to the task schema to track the connection. (Issue creation on task add is already done.)

- 🗓 **Custom workflow columns** — Extend the fixed TODO/DOING/REVIEW/DONE set. Pre-defined extra columns: `BLOCKED`, `QA`, `STAGING`. Users cannot enter free-form names; types stay fixed, each type's executor behavior (run agent / manual / deploy hook) defined separately.

---

## Working rule

Only **one** item should be active at a time. Finish it, use it, and if you like it move on. Do not start them all in parallel.
