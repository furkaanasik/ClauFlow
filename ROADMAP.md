# ROADMAP

## 1. Project Claude Config + Agent Studio

**Cost:** ~6–8 days · **Value:** very high (turns ClauFlow from a "task runner" into a "Claude project control panel")

A control panel inside the project detail screen that manages Claude's project-local surface. The user wires up agents / skills / instructions entirely through the GUI — no IDE, no CLI commands.

### Scope (MVP)

- **CLAUDE.md editor** — markdown editor + preview; write / update the project's global instructions
- **Agents CRUD** — list, create, edit, delete `.claude/agents/*.md`; frontmatter form + body editor
- **Skill Manager (in-project marketplace)** — discover skills from the Claude marketplace, **one-click install**, enable/disable, uninstall. The backend runs its own mini installer: `git clone` → `.claude/plugins/<slug>` → enable in `settings.json`. **Does not** depend on the CLI's interactive `/plugin install` flow.
- **Agent Studio (AI-assisted)** — the user does not write raw markdown: they give a prompt ("I want an agent that…") → Claude generates the agent markdown → user approves / iterates → it is written to disk. Drag-and-drop skill assignment, team setup.
- **Prereq onboarding** — check that `claude` / `git` / `gh` are installed; if not, show a guided screen with copy-to-clipboard commands

### Skill ↔ Agent assignment mode

Two options are supported, with soft as the default:
- **Soft**: a row is added to the "Available Skills" table in the agent's markdown body (a hint to Claude)
- **Hard**: a `tools:` whitelist in the agent's frontmatter (the agent cannot step outside that skill set)

### Out of scope (revisit later)

- `settings.json` visual editor
- Hooks editor
- MCP server config
- User-level (`~/.claude`) skill/agent management
- Adding custom marketplaces (default: verified sources only)

### Architecture notes

- Backend: `pluginRegistry`, `pluginInstaller`, `pluginManager`, `prereqCheck` services
- WS event: `skill_install_progress` (clone percentage, status)
- Agent Studio generates via the Claude API/CLI; nothing touches disk until the user approves
- UI: a new "Claude Config" tab inside `ProjectDetailDrawer`, sub-segmented (Instructions / Agents / Skills / Studio)

---

## Completed

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

Only **one** of the items above should be active at a time. Finish it, use it, and if you like it move on. Do not start them all in parallel.
