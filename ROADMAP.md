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

---

## Planned

- 🗓 **Studio skill injection** — Automatically inject the SKILL.md content of skills dragged onto an agent node into the agent prompt inside `buildNodePrompt`. Currently the `## Available Skills` table only enters the prompt as plain text; since slash commands don't work in `claude -p` headless mode, drag-and-drop has no effect at execution time. Solution: parse the agent body, read `~/.claude/skills/<skill>/SKILL.md` for each listed skill, and append the content as a block in the prompt. User behavior stays the same; real skill instructions are silently forwarded to the agent in the background.

- 🗓 **Studio main node** — Always keep a `main` agent node on the canvas. If no `main.md` agent exists when the project Studio opens, create one automatically; pin it to the top-left as the entry point, visually distinct from other nodes (custom border/badge). Other agents connect to this node via edges. If deleted, recreate it on the next load. Existing Studio bugs will also be fixed in this phase.

- 🗓 **Streaming token events (mid-run budget enforcement)** — currently `onResult` fires once after the full claude CLI run, so a $0.01 budget can't stop a $0.42 run mid-flight. Real enforcement requires parsing streaming JSON events during the run to accumulate token counts, compare against effective budget, and call `controller.abort()` before the run finishes. This enables tight per-task spending caps without relying on post-run detection.

- 🗓 **Docker distribution** — `docker.yml` GitHub Actions workflow: build multi-arch image (amd64 + arm64) on every `v*.*.*` tag, push to GitHub Container Registry (`ghcr.io/furkaanasik/clauflow`). Compose file (`docker-compose.yml`) at repo root: core + gui services, port mapping, volume for SQLite data. Goal: `docker compose up` → running ClauFlow, no Node install needed.

- 🗓 **GitHub Issues → Task import** — Pull open issues from a repo into the kanban with a single click. Parse `gh issue list` output, create selected issues as tasks. Goal: integrate ClauFlow into the existing workflow instead of running as a parallel system.

- 🗓 **PR auto-review** — When a task reaches the REVIEW column, Claude automatically runs a code review pass and posts the output as a comment on the PR. Currently the user reviews manually; add this step to the executor pipeline.

- 🗓 **Task breakdown AI** — "Break down" button in the task drawer: enter a large feature description, Claude splits it into 5-8 subtasks and adds them to the same project. The existing project planner operates at the project level; this operates at the task level.

- 🗓 **Notification system** — Notify when an agent finishes or errors: browser Notification API (ask for permission if needed) + optional webhook URL (Discord / Slack / custom). Currently requires watching the terminal.

- 🗓 **Claude model selector per-task** — Choose which model runs for each task (Haiku: fast/cheap, Sonnet: balanced, Opus: deep work). The executor currently uses a hardcoded model; add a `model` field to the task schema and pass it through to the executor.

- 🗓 **Task dependencies** — "Don't start this until that task is done" links. `dependsOn` relationship between tasks; dependent tasks automatically wait when moved to DOING, and are released when the dependency reaches DONE. Should integrate with the project planner: ordering between tasks generated from a prompt should be modeled as dependencies.

- 🗓 **Rollback button** — Revert a task in the DONE column with a single click: revert the branch via `gh pr revert` or `git revert` and close the PR. Currently manual git work.

- 🗓 **GitHub Issues two-way sync** — When a task is created, open a GitHub issue (`gh issue create`); when the task moves to DONE, close the issue. Add `issueNumber` to the existing `displayId` and `prNumber` fields.

- 🗓 **Custom workflow columns** — Extend the fixed TODO/DOING/REVIEW/DONE set. Pre-defined extra columns: `BLOCKED`, `QA`, `STAGING`. Users cannot enter free-form names; types stay fixed, each type's executor behavior (run agent / manual / deploy hook) defined separately.

---

## Working rule

Only **one** item should be active at a time. Finish it, use it, and if you like it move on. Do not start them all in parallel.
