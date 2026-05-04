# Graph Authoring Guide

## What is an Agent Graph?

An agent graph is a directed chain of Claude agents that each handle one phase of a task. The graph is stored in `.claude/agents/_graph.json` inside your project's repo. When a task is dragged to **Doing**, ClauFlow executes the nodes in order, passing each node's output to the next.

## Graph File Format

```json
{
  "nodes": [
    { "id": "a", "type": "agent", "position": { "x": 0, "y": 0 }, "data": { "slug": "planner" } },
    { "id": "b", "type": "agent", "position": { "x": 300, "y": 0 }, "data": { "slug": "coder" } }
  ],
  "edges": [
    { "id": "a-b", "source": "a", "target": "b" }
  ]
}
```

Each node references an agent by its `slug`. The slug maps to `.claude/agents/<slug>.md`.

## Node Types

| Slug keyword | Derived type | Purpose |
|---|---|---|
| `planner` | planner | Analyzes the task, produces a plan |
| `coder` | coder | Implements the plan |
| `reviewer` | reviewer | Reviews the diff |
| `tester` | tester | Writes or runs tests |
| anything else | custom | Free-form agent |

The type is derived from the slug automatically — a slug like `backend-coder` maps to the `coder` type.

## Creating a New Agent File

Create `.claude/agents/<slug>.md` in your project repo:

```markdown
---
name: My Agent
description: What this agent does
model: claude-sonnet-4-6
allowedTools: Read,Write,Edit,Bash
---

You are a specialized agent. Your task is to...
```

Frontmatter fields:

| Field | Required | Default | Notes |
|---|---|---|---|
| `name` | No | slug | Display name |
| `description` | No | — | Shown in Studio |
| `model` | No | project default | Any Claude model ID |
| `allowedTools` | No | all tools | Comma-separated list |

## Editing the Graph in Studio

1. Open a project → click **Studio** tab
2. Drag agent nodes from the palette onto the canvas
3. Connect nodes by dragging from one node's handle to another
4. Click **Save** — the graph is committed to `.claude/agents/_graph.json`

## Execution Model

Nodes run **sequentially**. Each node receives:
- The task title, description, and analysis
- The project's AI prompt as background context
- The previous node's text output (diff included when present)

Artifacts (text output + diff) flow from node to node automatically.

## Legacy Fallback

If `.claude/agents/_graph.json` does not exist, or the graph has 0 or 1 nodes, ClauFlow falls back to the single-claude execution path — the same behavior as before graphs were introduced.

## Validation Rules

The graph must satisfy all of the following or it will be rejected at runtime:

| Rule | Error |
|---|---|
| Exactly one entry node (no incoming edges) | `multiple_entries` or `no_entry` |
| No cycles | `cycle` |
| No branching (out-degree ≤ 1 per node) | `branching` |
| All nodes reachable from the entry | `disconnected` |
