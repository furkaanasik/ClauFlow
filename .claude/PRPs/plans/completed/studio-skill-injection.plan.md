# Plan: Studio Skill Injection

## Summary
When an agent node runs, parse the `## Available Skills` table from its body, read each skill's `SKILL.md` from `~/.claude/skills/<skillId>/SKILL.md`, and append the full content as inline blocks in the prompt built by `buildNodePrompt`. User drag-and-drop workflow is unchanged; skill instructions are silently forwarded to the headless agent.

## User Story
As a ClauFlow user, I want skill instructions to be injected into agent prompts at run time, so that skills dragged onto agent nodes actually influence agent behavior in headless `claude -p` runs.

## Problem → Solution
Currently `## Available Skills` is decorative text — the agent sees skill names but no instructions, because slash commands don't work in `claude -p` mode. → At prompt-build time, read each listed skill's `SKILL.md` and append its content so the agent has actual instructions.

## Metadata
- **Complexity**: Small
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 2 (graphRunner.ts + graphRunner.test.ts)

---

## UX Design

N/A — internal change. User drag-and-drop workflow unchanged; prompt is silently enriched.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `core/src/agents/graphRunner.ts` | 144-181 | `buildNodePrompt` to modify |
| P0 (critical) | `core/src/agents/graphRunner.ts` | 1-10 | Existing imports to extend |
| P1 (important) | `core/src/agents/graphRunner.test.ts` | 178-290 | Test pattern to follow |
| P1 (important) | `gui/src/components/Studio/AgentNode.tsx` | 108-120 | `parseSkillsFromBody` — mirror exact regex |

---

## Patterns to Mirror

### IMPORT_PATTERN
```typescript
// SOURCE: core/src/agents/graphRunner.ts:1
import { randomUUID } from "node:crypto";
// New imports follow same pattern — node: prefix, destructured
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
```

### PARSE_SKILLS_PATTERN
```typescript
// SOURCE: gui/src/components/Studio/AgentNode.tsx:108-120
// Mirror exactly — same regex, same cell parsing
function parseSkillsFromBody(body: string): string[] {
  const sectionMatch = body.match(/##\s+Available Skills\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!sectionMatch) return [];
  const skills: string[] = [];
  for (const line of sectionMatch[1]!.split("\n")) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 1 && cells[0] && !/^-+$/.test(cells[0]) && !/^Skill$/i.test(cells[0])) {
      skills.push(cells[0]);
    }
  }
  return skills;
}
```

### SKILL_LOAD_PATTERN
```typescript
// New helper — sync fs read, returns null on any failure
function loadSkillContent(skillId: string): string | null {
  // Only alphanumeric/dash/underscore/dot names are safe for path join
  if (!/^[A-Za-z0-9_.-]+$/.test(skillId)) return null;
  const skillPath = join(homedir(), ".claude", "skills", skillId, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  try {
    return readFileSync(skillPath, "utf8");
  } catch {
    return null;
  }
}
```

### BUILD_NODE_PROMPT_INJECTION
```typescript
// SOURCE: core/src/agents/graphRunner.ts:154-181 — append after existing sections
// Append skill blocks just before the closing "When done, exit the terminal." line
const skillIds = parseSkillsFromBody(agent.body);
for (const skillId of skillIds) {
  const content = loadSkillContent(skillId);
  if (content) {
    sections.push(`Skill: ${skillId}\n\n${content.trim()}`);
  }
}
sections.push("When done, exit the terminal.");
```

### TEST_STRUCTURE
```typescript
// SOURCE: core/src/agents/graphRunner.test.ts:178-195
describe("buildNodePrompt", () => {
  it("description of behavior", () => {
    const prompt = buildNodePrompt(agent, baseTask, baseProject, null);
    expect(prompt).toContain("expected string");
  });
});
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/agents/graphRunner.ts` | UPDATE | Add imports + 2 helpers + modify `buildNodePrompt` |
| `core/src/agents/graphRunner.test.ts` | UPDATE | Add test cases for skill injection |

## NOT Building

- Changes to GUI components (drag-drop behavior is already correct)
- Support for plugin marketplace skills via `installPath` (out of scope — only `~/.claude/skills/`)
- Network calls, async file reading, caching layer
- Any API endpoint changes

---

## Step-by-Step Tasks

### Task 1: Add node:fs, node:os, node:path imports
- **ACTION**: Add three new imports at the top of `graphRunner.ts` after the existing `node:crypto` import
- **IMPLEMENT**:
  ```typescript
  import { existsSync, readFileSync } from "node:fs";
  import { homedir } from "node:os";
  import { join } from "node:path";
  ```
- **MIRROR**: IMPORT_PATTERN
- **IMPORTS**: node built-ins, no new packages
- **GOTCHA**: Keep `node:` prefix to match existing style
- **VALIDATE**: `cd core && npm run typecheck` — zero errors

### Task 2: Add `parseSkillsFromBody` helper
- **ACTION**: Add function after `deriveNodeType` (line ~142) in `graphRunner.ts`
- **IMPLEMENT**: See PARSE_SKILLS_PATTERN above. Mirror the regex from `AgentNode.tsx:108-120` exactly.
- **MIRROR**: PARSE_SKILLS_PATTERN
- **IMPORTS**: none
- **GOTCHA**: The header row has "Skill" and the separator row has "---". Both must be filtered. Filter: `!/^-+$/.test(cells[0]) && !/^Skill$/i.test(cells[0])`
- **VALIDATE**: Unit test added in Task 4 covers this

### Task 3: Add `loadSkillContent` helper
- **ACTION**: Add function after `parseSkillsFromBody` in `graphRunner.ts`
- **IMPLEMENT**: See SKILL_LOAD_PATTERN above. Path: `homedir()/.claude/skills/<skillId>/SKILL.md`
- **MIRROR**: SKILL_LOAD_PATTERN
- **IMPORTS**: `existsSync`, `readFileSync` from `node:fs`; `homedir` from `node:os`; `join` from `node:path`
- **GOTCHA**: Validate `skillId` matches `/^[A-Za-z0-9_.-]+$/` before using in path — prevents path traversal
- **VALIDATE**: Unit test in Task 4; manual: `ls ~/.claude/skills/ccg/SKILL.md` confirms file exists

### Task 4: Modify `buildNodePrompt` to inject skills
- **ACTION**: In `buildNodePrompt` (line 144), move `sections.push("When done, exit the terminal.")` to AFTER the skill injection block
- **IMPLEMENT**:
  ```typescript
  // Replace the final push of "When done..." with:
  const skillIds = parseSkillsFromBody(agent.body);
  for (const skillId of skillIds) {
    const content = loadSkillContent(skillId);
    if (content) {
      sections.push(`Skill: ${skillId}\n\n${content.trim()}`);
    }
  }
  sections.push("When done, exit the terminal.");
  ```
- **MIRROR**: BUILD_NODE_PROMPT_INJECTION
- **IMPORTS**: none new (uses helpers from Tasks 2-3)
- **GOTCHA**: Skills with no SKILL.md are silently skipped — no error thrown
- **VALIDATE**: Existing tests still pass; new tests added in Task 5

### Task 5: Add test cases to `graphRunner.test.ts`
- **ACTION**: Add new `it()` blocks inside the existing `describe("buildNodePrompt")` block
- **IMPLEMENT**:

  ```typescript
  it("injects skill content when SKILL.md exists", () => {
    // Use vi.spyOn or mock fs — or use tmp dir approach
    // vitest: mock node:fs existsSync + readFileSync
    // Simplest: create a temp dir + file in beforeEach
  });
  ```

  Since the existing tests don't mock fs, use `vi.mock("node:fs")` for skill-specific tests only. Pattern:
  ```typescript
  import { vi } from "vitest";

  it("injects skill content for skills listed in body", () => {
    const agentWithSkill = {
      ...planner,
      body: "Do work.\n\n## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| my-skill | |\n",
    };
    vi.spyOn(fs, "existsSync").mockReturnValueOnce(true);
    vi.spyOn(fs, "readFileSync").mockReturnValueOnce("# My Skill\nDo X." as unknown as Buffer);
    const prompt = buildNodePrompt(agentWithSkill, baseTask, baseProject, null);
    expect(prompt).toContain("Skill: my-skill");
    expect(prompt).toContain("Do X.");
    vi.restoreAllMocks();
  });

  it("skips skills with no SKILL.md", () => {
    const agentWithSkill = {
      ...planner,
      body: "Do work.\n\n## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| missing | |\n",
    };
    vi.spyOn(fs, "existsSync").mockReturnValueOnce(false);
    const prompt = buildNodePrompt(agentWithSkill, baseTask, baseProject, null);
    expect(prompt).not.toContain("Skill: missing");
    vi.restoreAllMocks();
  });

  it("skips skills with unsafe IDs (path traversal guard)", () => {
    const agentWithSkill = {
      ...planner,
      body: "Do work.\n\n## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| ../secret | |\n",
    };
    const prompt = buildNodePrompt(agentWithSkill, baseTask, baseProject, null);
    expect(prompt).not.toContain("Skill: ../secret");
  });

  it("does not inject when no Available Skills section", () => {
    const prompt = buildNodePrompt(planner, baseTask, baseProject, null);
    expect(prompt).not.toContain("Skill:");
  });
  ```

- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: `import * as fs from "node:fs"` at top of test file; `import { vi } from "vitest"`
- **GOTCHA**: `readFileSync` mock must return `string` but TS overloads expect `Buffer` — cast as shown
- **VALIDATE**: `cd core && npm test -- graphRunner` all pass

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Skill with SKILL.md | body with `my-skill`, mocked existsSync=true, mocked readFileSync | prompt contains `Skill: my-skill` + content | No |
| Missing SKILL.md | body with `missing`, mocked existsSync=false | prompt does not contain `Skill: missing` | No |
| Unsafe skill ID | body with `../secret` | prompt does not contain skill block | Yes — path traversal |
| No skills section | plain body | prompt unchanged (no `Skill:` block) | No |

### Edge Cases Checklist
- [x] Skill ID with path-traversal chars (`../`) → guard rejects
- [x] No `## Available Skills` section → no injection
- [x] Skill listed but SKILL.md absent → silently skipped
- [x] Multiple skills → each injected independently
- [ ] Very large SKILL.md — no truncation needed (SKILL.md files are instructions, typically <10KB)

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
```
EXPECT: Zero type errors

### Unit Tests
```bash
cd core && npm test -- graphRunner
```
EXPECT: All tests pass (existing + new)

### Full Test Suite
```bash
cd core && npm test
```
EXPECT: No regressions

### Manual Validation
- [ ] Create an agent in Studio, drag a skill (e.g. `ccg`) onto it
- [ ] Start a task with that agent
- [ ] Open agent logs — skill content should appear in the prompt block
- [ ] Verify `~/.claude/skills/ccg/SKILL.md` content is present in the raw prompt

---

## Acceptance Criteria
- [ ] Skills listed in `## Available Skills` have their `SKILL.md` content appended in the prompt
- [ ] Skills with no local SKILL.md are silently skipped
- [ ] Path traversal guard rejects unsafe skill IDs
- [ ] All existing `buildNodePrompt` tests pass
- [ ] Four new test cases pass
- [ ] Zero type errors

## Completion Checklist
- [ ] `import { existsSync, readFileSync } from "node:fs"` added
- [ ] `import { homedir } from "node:os"` added
- [ ] `import { join } from "node:path"` added
- [ ] `parseSkillsFromBody` added and exported for test access
- [ ] `loadSkillContent` added (path traversal guard included)
- [ ] `buildNodePrompt` injects skill blocks before "When done" line
- [ ] Tests added in `graphRunner.test.ts`
- [ ] No comments added (code is self-explanatory)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SKILL.md too large → inflated prompt | Low | Medium | SKILL.md files are short by convention; no truncation needed |
| `existsSync`/`readFileSync` throw unexpectedly | Very Low | Low | `try/catch` in `loadSkillContent` returns null |
| Path traversal via crafted skill ID | Low | High | `/^[A-Za-z0-9_.-]+$/` guard in `loadSkillContent` |

## Notes
- `parseSkillsFromBody` mirrors the gui-side logic at `AgentNode.tsx:108-120` exactly — keep in sync if the section format ever changes
- Only `~/.claude/skills/<id>/SKILL.md` is checked; marketplace plugin skills (in `~/.claude/plugins/cache/`) are out of scope for this plan
- `buildNodePrompt` stays synchronous — `existsSync`/`readFileSync` are sync FS calls
