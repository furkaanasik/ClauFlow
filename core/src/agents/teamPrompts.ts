import { defaultSkillRoots, readSkillBody, type SkillCatalogRoots } from "../services/skillCatalogService.js";
import type { Project, RoleKind, Task, TeamRole } from "../types/index.js";

export const SKILL_CHAR_CAP = 20_000;
export const SKILL_TOTAL_CAP = 60_000;
export const DIFF_CHAR_CAP = 30_000;

/** Today's single-CLI testing block, used verbatim by every developer role. */
export const TESTING_INSTRUCTIONS =
  `Testing requirements:\n` +
  `- Before coding, detect the repo's test runner: check package.json scripts ("test", "test:unit"), and config files (vitest.config.*, jest.config.*, pytest.ini, pyproject.toml with pytest, go.mod for go test).\n` +
  `- If a runner exists, write unit tests that cover each acceptance criterion as an assertion. Prefer testing observable behavior over implementation details.\n` +
  `- If NO test runner is configured and this looks like a greenfield repo, set up a minimal one matching the stack: vitest for TypeScript/JavaScript, pytest for Python, go test for Go. Add an "npm test" (or equivalent) script.\n` +
  `- Run the test command after writing tests. Do not finish until tests pass. If a test reveals a bug in your implementation, fix the implementation — do not weaken the test.\n` +
  `- Skip tests only for pure config/docs changes where behavior cannot be meaningfully asserted.`;

export function roleMarker(kind: RoleKind, round: number): string {
  return `<!-- clauflow-role: ${kind} round: ${round} -->`;
}

const OUTPUT_CONTRACT: Record<RoleKind, string> = {
  ceo: [
    "Output contract:",
    "- Your final message is your deliverable. It is stored and handed to the next role, so put the whole brief in it.",
    "- Start it with the heading `## Brief`, then sub-headings for Goal, Scope, Out of scope and Assumptions (in the task's language).",
    "- Never ask questions. Record open points under Assumptions.",
  ].join("\n"),
  analyst: [
    "Output contract:",
    "- Your final message is your deliverable. It is stored and handed to the developer, so put the whole specification in it.",
    "- Start it with the heading `## Şartname`, then sub-headings for What to build, Files, Acceptance criteria and Test suggestions (in the task's language).",
    "- Number acceptance criteria `AC-1`, `AC-2`, ... Each one must be objectively checkable.",
  ].join("\n"),
  developer: [
    "Output contract:",
    "- Implement the change in the working tree. Do not create git commits or switch branches; ClauFlow commits your work after you finish.",
    "- Your final message is your delivery note. Start it with the heading `## Teslim notu` and list the changed files, how each acceptance criterion is met, and the test command with its result.",
  ].join("\n"),
  qa: [
    "Output contract:",
    "- Do not modify files. Do not create commits.",
    "- Your final message is your QA report. Start it with the heading `## QA raporu`, mark each acceptance criterion ✓ or ✗ with a one-line reason, and summarise the test output.",
    "- End the report with exactly one machine-readable line: `VERDICT: PASS` or `VERDICT: FAIL`.",
    "- If the verdict is FAIL, add a `## Hata listesi` section after the verdict with numbered items (`1. ...`) the developer can act on.",
  ].join("\n"),
};

const COMMON_RULES = [
  "You are one role in a ClauFlow team run. Other roles run before and after you; do only your own part.",
  "Write your deliverable in the language of the task. Keep the required headings and the VERDICT line exactly as specified.",
  "If a tool call is rejected by a hook or policy, read the reason, satisfy it if it is reasonable, and retry once.",
].join("\n");

export interface LoadedSkill {
  id: string;
  body: string;
}

export interface SkillSections {
  text: string;
  injected: string[];
  truncated: string[];
  skipped: string[];
}

export function buildSkillSections(skills: LoadedSkill[]): SkillSections {
  const parts: string[] = [];
  const injected: string[] = [];
  const truncated: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const skill of skills) {
    const remaining = SKILL_TOTAL_CAP - total;
    const cap = Math.min(SKILL_CHAR_CAP, remaining);
    if (cap <= 0) {
      skipped.push(skill.id);
      continue;
    }
    let body = skill.body.trim();
    if (body.length > cap) {
      body = `${body.slice(0, cap)}\n\n[skill truncated at ${cap} characters]`;
      truncated.push(skill.id);
    }
    total += Math.min(skill.body.trim().length, cap);
    parts.push(`Skill: ${skill.id}\n\n${body}`);
    injected.push(skill.id);
  }
  return { text: parts.join("\n\n"), injected, truncated, skipped };
}

function needsPluginList(ids: string[]): boolean {
  return ids.some((id) => !id.startsWith("user:") && !id.startsWith("project:"));
}

export async function loadRoleSkills(
  ids: string[],
  repoPath: string,
  roots?: SkillCatalogRoots,
): Promise<{ skills: LoadedSkill[]; missing: string[] }> {
  if (ids.length === 0) return { skills: [], missing: [] };
  const resolvedRoots: SkillCatalogRoots = roots ?? {
    ...defaultSkillRoots(repoPath),
    ...(needsPluginList(ids) ? {} : { listPlugins: async () => [] }),
  };
  const skills: LoadedSkill[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const body = await readSkillBody(id, resolvedRoots);
    if (body) skills.push({ id, body });
    else missing.push(id);
  }
  return { skills, missing };
}

export function buildRoleSystemPrompt(
  role: TeamRole,
  round: number,
  skills: LoadedSkill[] = [],
): { text: string; skills: SkillSections } {
  const skillSections = buildSkillSections(skills);
  const parts = [
    roleMarker(role.kind, round),
    COMMON_RULES,
    `Role: ${role.name}`,
    role.instructions.trim(),
    OUTPUT_CONTRACT[role.kind],
  ];
  if (skillSections.text) parts.push(skillSections.text);
  return { text: parts.filter(Boolean).join("\n\n"), skills: skillSections };
}

export interface RolePromptContext {
  task: Pick<Task, "title" | "description" | "analysis">;
  project: Pick<Project, "aiPrompt">;
  round: number;
  /** True when the team is a lone developer (Solo): keeps today's single-CLI prompt. */
  solo: boolean;
  brief?: string | null;
  spec?: string | null;
  delivery?: string | null;
  bugList?: string | null;
  diff?: string | null;
  baseBranch?: string;
}

/** Today's single-CLI prompt, byte-for-byte. */
export function buildSoloPrompt(ctx: Pick<RolePromptContext, "task" | "project">): string {
  const taskBrief = ctx.task.analysis || ctx.task.description || ctx.task.title;
  const background = ctx.project.aiPrompt?.trim();
  return background
    ? `Project background (reference only — do NOT implement features beyond the current task's scope):\n` +
        `<project_background>\n${background}\n</project_background>\n\n` +
        `Current task — implement exactly what this describes, nothing more:\n` +
        `<task>\n${taskBrief}\n</task>\n\n` +
        `${TESTING_INSTRUCTIONS}\n\n` +
        `When done, exit the terminal.`
    : `Implement the following task and exit the terminal when done:\n\n` +
        `<task>\n${taskBrief}\n</task>\n\n` +
        TESTING_INSTRUCTIONS;
}

function block(tag: string, body: string | null | undefined): string | null {
  const t = body?.trim();
  return t ? `<${tag}>\n${t}\n</${tag}>` : null;
}

function taskBlock(task: RolePromptContext["task"]): string {
  const parts = [`Title: ${task.title}`];
  if (task.description?.trim()) parts.push(`Description:\n${task.description.trim()}`);
  if (task.analysis?.trim()) parts.push(`Analysis:\n${task.analysis.trim()}`);
  return `<task>\n${parts.join("\n\n")}\n</task>`;
}

export function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_CHAR_CAP) return diff;
  return `${diff.slice(0, DIFF_CHAR_CAP)}\n[diff truncated to ${DIFF_CHAR_CAP} characters]`;
}

export function buildRolePrompt(role: TeamRole, ctx: RolePromptContext): string {
  if (role.kind === "developer" && ctx.solo) return buildSoloPrompt(ctx);

  const background = block("project_background", ctx.project.aiPrompt);
  const sections: Array<string | null> = [
    background ? `Project background (reference only — do NOT go beyond the task's scope):\n${background}` : null,
    `Task:\n${taskBlock(ctx.task)}`,
  ];

  switch (role.kind) {
    case "ceo":
      sections.push("Write the brief for this task.");
      break;
    case "analyst":
      sections.push(block("ceo_brief", ctx.brief));
      sections.push("Write the specification for this task.");
      break;
    case "developer":
      sections.push(block("ceo_brief", ctx.brief));
      sections.push(block("specification", ctx.spec));
      if (ctx.round > 1) {
        sections.push(
          `This is QA round ${ctx.round}. QA rejected the previous delivery. Fix every item in the bug list first.`,
        );
        sections.push(block("qa_bug_list", ctx.bugList));
        sections.push(block("previous_delivery_note", ctx.delivery));
      }
      sections.push(TESTING_INSTRUCTIONS);
      sections.push("When done, write the delivery note and exit the terminal.");
      break;
    case "qa": {
      sections.push(block("specification", ctx.spec));
      sections.push(block("delivery_note", ctx.delivery));
      const diff = ctx.diff?.trim()
        ? `Diff of the task branch (\`git diff ${ctx.baseBranch ?? "<base>"}...HEAD\`):\n\`\`\`diff\n${truncateDiff(ctx.diff)}\n\`\`\``
        : "The task branch has no changes against the base branch yet.";
      sections.push(diff);
      sections.push(
        `This is QA round ${ctx.round}. Check every acceptance criterion, run the tests, then write the QA report ending with the VERDICT line.`,
      );
      break;
    }
  }
  return sections.filter((s): s is string => !!s).join("\n\n");
}
