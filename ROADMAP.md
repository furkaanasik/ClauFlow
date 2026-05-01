# ROADMAP

## 1. Project Claude Config + Agent Studio

**Total cost:** ~6–8 days · **Value:** very high (turns ClauFlow from a "task runner" into a "Claude project control panel")

A control panel inside the project detail screen that manages Claude's project-local surface. The user wires up agents / skills / instructions entirely through the GUI — no IDE, no CLI commands.

This epic is **sliced into five independently-shippable phases**. Each phase ends with a green PR and is usable on its own; later phases layer on richer features. Suggested order: **1A → 1C → 1B → 1D → 1E** (1C can run in parallel with 1A).

### Dependency graph

```
1A ✅ (foundation) ─┬── 1B ✅ (agents) ──┐
                    │                     ├── 1E (studio)
                    └── 1D ✅ (skills) ──┘

1C ✅ (prereqs) — independent, can run in parallel
```

---

### ✅ Phase 1A — Claude Config tab + CLAUDE.md editor (~1 day)

The foundation everything else attaches to.

- New "Claude Config" tab inside `ProjectDetailDrawer`, sub-segmented skeleton (Instructions / Agents / Skills / Studio)
- First segment: **Instructions** — read `CLAUDE.md`, markdown textarea, fullscreen modal with split editor + live preview (synchronized scroll), save commits the file on the current branch (no auto-push), explicit Push button when a remote exists
- Backend: `GET/PUT /api/projects/:id/claude/instructions`, `POST .../instructions/push`

**Ships:** the user can edit project instructions without opening an IDE.

---

### ✅ Phase 1B — Agents CRUD (~1–1.5 days)

Depends on 1A.

- "Agents" segment — list `.claude/agents/*.md`; frontmatter form (name, model, description) + body markdown editor with fullscreen split/preview
- Create / delete / edit agents; model picker with curated presets + custom override
- Auto-bootstraps `.claude/settings.json` (team env + bypassPermissions) when an agent is created or when an existing project with agents is opened, and removes it again on the last delete (only if untouched)
- Repo-wide settings consolidation: `.claude/settings.json` is now committed (team env), `.claude/settings.local.json` stays gitignored for personal overrides
- Backend: `GET/POST/PUT/DELETE /api/projects/:id/claude/agents/:slug`, plus generic `POST /:id/claude/push`

**Ships:** manual agent setup no longer requires an IDE; the team feature is automatically wired in any project where an agent is added.

---

### ✅ Phase 1C — Prereq onboarding (~0.5 day)

Independent — can ship before, after, or in parallel with anything else.

- A small "Prereq" banner in the header or project drawer — shells out to check the versions of `claude`, `git`, `gh`
- If something is missing, surface copy-to-clipboard install commands
- Backend: `GET /api/system/prereqs`

**Ships:** first-run friction drops for new users.

---

### ✅ Phase 1D — Skill Manager

- "Skills" segment with three tabs: Installed, Registry, Marketplaces — backed by a thin passthrough over `claude plugin ...` CLI subcommands (no custom registry JSON, no manual git clone). Installs land as real Claude plugins and show up in `claude /skills`.
- Backend service: `claudePluginCli.ts` (single `spawn` wrapper, JSON parse, 60s timeout); routes under `/api/projects/:id/claude/skills*` and `.../marketplaces*`. WS event `skill_install_progress` (`running` → `done`/`error`).
- Frontend: scope dropdown on install (default `local`), instant client-side search, install-count badges, external-link button (homepage → source), single Installed list with enable/disable/uninstall, Marketplaces add (URL / `owner/repo` / path) with confirmation on remove.
- Initial cut shipped a custom `<repoPath>/.claude/plugins/<slug>` clone path which Claude Code did not actually discover; pivoted mid-PR to the CLI passthrough, dropping `pluginRegistry` / `pluginInstaller` / `pluginManager` in favor of `claudePluginCli`.

**Shipped:** the skill ecosystem opens up via the GUI, fully integrated with Claude's real plugin system.

---

### Phase 1E — Agent Studio (AI-assisted) (~2 days)

Depends on 1B and 1D.

- "Studio" segment — prompt input → Claude API generates agent markdown → preview → user approval → write to disk (reuses 1B's endpoint)
- Drag-and-drop skill assignment (uses 1D's skill list, soft mode by default)
- Nothing touches disk until the user approves.

**Ships:** the headline feature — users produce agents without writing raw markdown.

---

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

### ⚠️ Phase 1D follow-up — real Claude plugin integration

Phase 1D's first cut clones into `<repoPath>/.claude/plugins/<slug>` and toggles a `plugins[]` array in `<repoPath>/.claude/settings.json`. Claude Code's actual plugin system stores cache at `~/.claude/plugins/cache/<marketplace>/<slug>/<version>` and tracks state in `~/.claude/plugins/installed_plugins.json` — so the install flow we shipped does **not** make a skill discoverable by `claude /skills` in practice. The Installed view was patched to also read `~/.claude/plugins/installed_plugins.json` (read-only, with scope badges) so users can at least see what's really there. Pivot work needed: replace the manual `git clone` with a real plugin-install mechanism (CLI passthrough or direct manipulation of `installed_plugins.json` + marketplace cache), and rethink the project-local `plugins[]` array entirely.

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
