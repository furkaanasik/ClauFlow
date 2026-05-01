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

## Working rule

Only **one** item should be active at a time. Finish it, use it, and if you like it move on. Do not start them all in parallel.
