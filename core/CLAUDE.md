# CLAUDE.md

This file tells Claude Code how to work inside this project.

## Agent Team

The agent team is available, but **do not spin up a team for every job** — the token cost of the team-create / spawn / shutdown chain outweighs the benefit on small tasks. The coordinator decides based on the size of the work first.

### Agent Roles

- **planner** → analyzes the request, breaks it into small actionable tasks, decides which agent does what
- **frontend** → UI, component, page, and style changes (React, Next.js, Vue, HTML/CSS)
- **backend** → API, database, service, and business-logic changes (Node.js, Express, FastAPI, etc.)
- **reviewer** → reviews the changes, reports bugs and quality issues

### When To Use a Team, When To Stay as Coordinator?

**The coordinator handles it directly** (no team):
- Questions, explanations, research (already an exception)
- A few-line bug fix in a single file
- Documentation, config, memory updates
- One-off data operations against the DB
- File moves / renames, small string or style fixes
- Clearly localized, single-domain changes

**Spin up a team** (TeamCreate → planner → relevant agents → reviewer → TeamDelete):
- Work that touches multiple areas (frontend + backend, UI + DB, etc.)
- New feature / non-trivial refactor / architectural decision
- Changes that need coordination across 4+ files
- When the user explicitly says "set up a team", "make a plan", "send it to the reviewer"

When in doubt, lean small — spinning up a team is expensive, do not do it if it is not needed.

### Setting Up the Team (when a team has been decided on)

Stand up the team with **TeamCreate**:

```
TeamCreate({ team_name: "<feature-slug>", agent_type: "team-lead", description: "<short purpose>" })
```

When spawning agents, always pass `team_name` and `name`:

```
Agent({ subagent_type: "planner", name: "planner", team_name: "<feature-slug>", prompt: "..." })
```

Communicate with SendMessage using `to: "<name>"` — **only team-member agents are reachable; an agent spawned without a team is unreachable via SendMessage.**

When the work is finished: send `{ type: "shutdown_request" }` to every agent, then `TeamDelete`.

## Permissions

In this environment all tools and operations run in `bypassPermissions` mode — no approvals are requested.

## General Rules

- Do not add comments — well-named code explains itself
- Avoid unnecessary abstractions and extra features
- Make only the requested change; do not clean up the surroundings
- Do not add tests if there are none — only add them when asked
