import { defaultSkillRoots, readSkillBody, type SkillCatalogRoots } from "../services/skillCatalogService.js";
import type { Project, QaVerdict, RoleKind, Task, TeamRole } from "../types/index.js";
import type { UiLang } from "./uiText.js";
import { conflictHunks } from "./conflictMarkers.js";

export const SKILL_CHAR_CAP = 20_000;
export const SKILL_TOTAL_CAP = 60_000;
export const DIFF_CHAR_CAP = 30_000;
/** A8e: every context section (brief, spec, delivery, bug list, analysis, description, project background). */
export const SECTION_CHAR_CAP = 20_000;

function capSection(body: string, label: string): string {
  if (body.length <= SECTION_CHAR_CAP) return body;
  return `${body.slice(0, SECTION_CHAR_CAP)}\n[${label} truncated to ${SECTION_CHAR_CAP} characters]`;
}

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

/**
 * Marker of a comment round (E7b, plan §3/30): the developer role's system
 * prompt with this marker instead of `roleMarker("developer", …)`, so the fake
 * CLI does not treat the call as a team developer round.
 */
export function buildCommentSystemMarker(n: number): string {
  return `<!-- clauflow-role: comment round: ${n} -->`;
}

/**
 * Marker of a conflict resolver round (zincir F4.6, plan §3/35): the developer
 * role's system prompt with this marker, so the fake CLI answers as the
 * `conflict_resolver` role instead of a team developer round.
 */
export function buildConflictSystemMarker(n: number): string {
  return `<!-- clauflow-role: conflict_resolver round: ${n} -->`;
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

interface LoadedSkill {
  id: string;
  body: string;
}

interface SkillSections {
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
  /** Replaces `roleMarker(role.kind, round)` (comment rounds; F4.6 conflict resolver). */
  opts: { marker?: string } = {},
): { text: string; skills: SkillSections } {
  const skillSections = buildSkillSections(skills);
  const parts = [
    opts.marker ?? roleMarker(role.kind, round),
    COMMON_RULES,
    `Role: ${role.name}`,
    role.instructions.trim(),
    OUTPUT_CONTRACT[role.kind],
  ];
  if (skillSections.text) parts.push(skillSections.text);
  return { text: parts.filter(Boolean).join("\n\n"), skills: skillSections };
}

interface RolePromptContext {
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
  const taskBrief = capSection(ctx.task.analysis || ctx.task.description || ctx.task.title, "task");
  const rawBackground = ctx.project.aiPrompt?.trim();
  const background = rawBackground ? capSection(rawBackground, "project_background") : rawBackground;
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
  return t ? `<${tag}>\n${capSection(t, tag)}\n</${tag}>` : null;
}

function taskBlock(task: RolePromptContext["task"]): string {
  const parts = [`Title: ${task.title}`];
  if (task.description?.trim()) parts.push(`Description:\n${capSection(task.description.trim(), "description")}`);
  if (task.analysis?.trim()) parts.push(`Analysis:\n${capSection(task.analysis.trim(), "analysis")}`);
  return `<task>\n${parts.join("\n\n")}\n</task>`;
}

function truncateDiff(diff: string): string {
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

interface CommentPromptContext {
  task: Pick<Task, "title" | "description" | "analysis">;
  project: Pick<Project, "aiPrompt">;
  /** Last `spec` artifact of the task, if a team wrote one. */
  spec?: string | null;
  /** Last `qa_report` artifact of the task. */
  qaReport?: { verdict: QaVerdict | null; body: string } | null;
  /** The user's comment body. */
  comment: string;
  /** GUI language; English when the request did not send one (§3/10). */
  uiLang?: UiLang;
}

const UI_LANG_NAME: Record<UiLang, string> = { tr: "Türkçe", en: "English" };

/**
 * A comment is the developer role's next round (E7b, plan §3/30): the task, the
 * last spec and QA report, and the user's feedback in `<user_feedback>`.
 */
export function buildCommentPrompt(role: TeamRole, ctx: CommentPromptContext): string {
  const background = block("project_background", ctx.project.aiPrompt);
  const qa = ctx.qaReport?.body.trim()
    ? `Last QA verdict: ${ctx.qaReport.verdict ? ctx.qaReport.verdict.toUpperCase() : "none"}\n${block("qa_report", ctx.qaReport.body)}`
    : null;
  const sections: Array<string | null> = [
    background ? `Project background (reference only — do NOT go beyond the task's scope):\n${background}` : null,
    `Task:\n${taskBlock(ctx.task)}`,
    block("specification", ctx.spec),
    qa,
    `You are the ${role.name} role, back for another round on this task's branch. ` +
      `The user reviewed the work and left the feedback below. Apply exactly what it asks, nothing more.`,
    `<user_feedback>\n${capSection(ctx.comment.trim(), "user_feedback")}\n</user_feedback>`,
    TESTING_INSTRUCTIONS,
    `Write any reply in ${UI_LANG_NAME[ctx.uiLang ?? "en"]}.`,
    "When done, write the delivery note and exit the terminal.",
  ];
  return sections.filter((s): s is string => !!s).join("\n\n");
}

/** Per-file and total caps of the `<conflicts>` section (§3/36). */
export const CONFLICT_FILE_CHAR_CAP = 8_000;
const MERGED_TASK_DESC_CAP = 2_000;
const MERGED_TASKS_MAX = 10;

interface ConflictPromptContext {
  task: Pick<Task, "title" | "description" | "analysis">;
  project: Pick<Project, "aiPrompt">;
  /** Last `spec` artifact of the task, if a team wrote one. */
  spec?: string | null;
  /** What was merged into the branch (`origin/main` or `main`). */
  target: string;
  branch: string;
  /** Tasks merged into the base since the branch point (§3/37), oldest first. */
  mergedTasks: Array<Pick<Task, "title" | "description"> & { displayId?: string | null }>;
  /** Conflicted files with their working-tree text (null: unreadable). */
  conflicts: Array<{ path: string; text: string | null }>;
  /** GUI language of the resolution note; English when absent. */
  uiLang?: UiLang;
}

function conflictsSection(conflicts: ConflictPromptContext["conflicts"]): string {
  const parts: string[] = [];
  const overflow: string[] = [];
  let total = 0;
  for (const c of conflicts) {
    const hunks = c.text ? conflictHunks(c.text) : "";
    if (!hunks) {
      parts.push(`File: ${c.path}\n(no conflict block shown here; open the file)`);
      continue;
    }
    if (hunks.length > CONFLICT_FILE_CHAR_CAP || total + hunks.length > DIFF_CHAR_CAP) {
      overflow.push(c.path);
      continue;
    }
    total += hunks.length;
    parts.push(`File: ${c.path}\n${hunks}`);
  }
  for (const path of overflow) parts.push(`File: ${path}\n(conflict too large to include here; open the file)`);
  return `<conflicts>\n${parts.join("\n\n")}\n</conflicts>`;
}

/**
 * The conflict resolver's prompt (zincir F4.6, plan §3/36): the task, its
 * spec, the work merged into the base since the branch point, the conflicted
 * hunks, and the rules (keep both intents, remove every marker, never touch git).
 */
export function buildConflictPrompt(ctx: ConflictPromptContext): string {
  const background = block("project_background", ctx.project.aiPrompt);
  const merged = ctx.mergedTasks.slice(0, MERGED_TASKS_MAX).map((t) => {
    const head = `${t.displayId ?? "?"} · ${t.title}`;
    const desc = t.description?.trim();
    if (!desc) return head;
    const capped =
      desc.length > MERGED_TASK_DESC_CAP ? `${desc.slice(0, MERGED_TASK_DESC_CAP)} [truncated]` : desc;
    return `${head}\n${capped}`;
  });
  const sections: Array<string | null> = [
    background ? `Project background (reference only — do NOT go beyond the task's scope):\n${background}` : null,
    `Task:\n${taskBlock(ctx.task)}`,
    block("specification", ctx.spec),
    merged.length > 0
      ? `Work merged into the base branch (${ctx.target}) since this task's branch was created:\n` +
        `<merged_into_base>\n${merged.join("\n\n")}\n</merged_into_base>`
      : null,
    `ClauFlow merged \`${ctx.target}\` into this task's branch \`${ctx.branch}\` and git stopped on conflicts. ` +
      `The conflicted files are in the working tree with their conflict markers:`,
    conflictsSection(ctx.conflicts),
    [
      "Rules:",
      "- Keep BOTH intents: the base side carries work that is already merged and approved; this task's side carries the task above.",
      "- Remove every conflict marker (<<<<<<<, |||||||, =======, >>>>>>>) from every conflicted file.",
      "- Do NOT run git commit, merge, rebase, reset, checkout, stash or push; ClauFlow owns git.",
    ].join("\n"),
    TESTING_INSTRUCTIONS,
    "End with a resolution note: one line per file, what each side wanted and what you kept.",
    `Write the note in ${UI_LANG_NAME[ctx.uiLang ?? "en"]}.`,
  ];
  return sections.filter((s): s is string => !!s).join("\n\n");
}

/**
 * The QA round's extra block after a conflict resolution (§5.10): the
 * conflicted files and the resolver's note, in `<conflict_resolution>`.
 */
export function buildConflictResolutionBlock(target: string, files: string[], note: string): string {
  return [
    `This QA round checks a conflict resolution: ClauFlow merged \`${target}\` into the task branch and the resolver resolved the conflicts below. ` +
      "Check that both sides' intents survived and that the tests pass.",
    `<conflict_resolution>\nConflicted files:\n${files.map((f) => `- ${f}`).join("\n")}\n\n` +
      `Resolution note:\n${capSection(note.trim() || "(empty)", "resolution_note")}\n</conflict_resolution>`,
  ].join("\n\n");
}
