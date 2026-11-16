import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillCatalogRoots } from "../services/skillCatalogService.js";
import { defaultRole } from "../services/teamTemplates.js";
import { ARG_BYTES_LIMIT, buildClaudeArgs } from "../services/claudeService.js";
import {
  buildCommentPrompt,
  buildCommentSystemMarker,
  buildRolePrompt,
  buildRoleSystemPrompt,
  buildSkillSections,
  buildSoloPrompt,
  DIFF_CHAR_CAP,
  loadRoleSkills,
  roleMarker,
  SECTION_CHAR_CAP,
  SKILL_CHAR_CAP,
  SKILL_TOTAL_CAP,
  TESTING_INSTRUCTIONS,
} from "./teamPrompts.js";

let root = "";
let roots: SkillCatalogRoots;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ekipler-prompts-"));
  const plugin = join(root, "plugins", "ecc");
  mkdirSync(join(plugin, "skills", "tdd-workflow"), { recursive: true });
  writeFileSync(
    join(plugin, "skills", "tdd-workflow", "SKILL.md"),
    "---\nname: tdd-workflow\ndescription: tdd\n---\n# TDD\n\nWrite the test first.\n",
  );
  mkdirSync(join(root, "repo", ".claude", "skills", "house-style"), { recursive: true });
  writeFileSync(join(root, "repo", ".claude", "skills", "house-style", "SKILL.md"), "Use tabs.\n");
  roots = {
    homeDir: join(root, "home"),
    projectRepoPath: join(root, "repo"),
    listPlugins: async () => [{ id: "ecc@ecc", installPath: plugin, enabled: true }],
  };
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const task = { title: "Add slugify", description: "slugify helper", analysis: "" };

describe("role system prompt", () => {
  it("starts with the role marker and carries instructions and the output contract", () => {
    const { text } = buildRoleSystemPrompt(defaultRole("qa"), 2);
    expect(text.startsWith(roleMarker("qa", 2))).toBe(true);
    expect(text).toContain("<!-- clauflow-role: qa round: 2 -->");
    expect(text).toContain(defaultRole("qa").instructions);
    expect(text).toContain("VERDICT: PASS");
    expect(text).toContain("## Hata listesi");
  });

  it("injects a plugin:skill body (frontmatter stripped) and a project skill", async () => {
    const { skills, missing } = await loadRoleSkills(["ecc:tdd-workflow", "project:house-style", "ecc:nope"], "/unused", roots);
    expect(missing).toEqual(["ecc:nope"]);
    const { text, skills: sections } = buildRoleSystemPrompt(defaultRole("developer"), 1, skills);
    expect(sections.injected).toEqual(["ecc:tdd-workflow", "project:house-style"]);
    expect(text).toContain("Skill: ecc:tdd-workflow\n\n# TDD\n\nWrite the test first.");
    expect(text).toContain("Skill: project:house-style\n\nUse tabs.");
    expect(text).not.toContain("description: tdd");
  });

  it("caps each skill at 20k and the total at 60k characters", () => {
    const big = "x".repeat(SKILL_CHAR_CAP + 500);
    const skills = ["a", "b", "c", "d"].map((n) => ({ id: `user:${n}`, body: big }));
    const s = buildSkillSections(skills);
    expect(s.injected).toEqual(["user:a", "user:b", "user:c"]);
    expect(s.truncated).toEqual(["user:a", "user:b", "user:c"]);
    expect(s.skipped).toEqual(["user:d"]);
    const xs = (s.text.match(/x/g) ?? []).length;
    expect(xs).toBe(SKILL_TOTAL_CAP);
  });

  it("gives a later skill only the remaining total budget", () => {
    const s = buildSkillSections([
      { id: "user:a", body: "a".repeat(SKILL_CHAR_CAP) },
      { id: "user:b", body: "b".repeat(SKILL_CHAR_CAP) },
      { id: "user:c", body: "c".repeat(SKILL_CHAR_CAP - 100) },
      { id: "user:d", body: "d".repeat(50) },
    ]);
    expect(s.injected).toEqual(["user:a", "user:b", "user:c", "user:d"]);
    expect(s.truncated).toEqual([]);
  });
});

describe("role -p prompts", () => {
  it("Solo developer keeps today's prompt with the testing instructions verbatim", () => {
    const p = buildRolePrompt(defaultRole("developer"), { task, project: {}, round: 1, solo: true });
    expect(p).toBe(buildSoloPrompt({ task, project: {} }));
    expect(p).toContain(TESTING_INSTRUCTIONS);
    expect(p.startsWith("Implement the following task")).toBe(true);
  });

  it("analyst sees the brief, developer sees brief and spec", () => {
    const a = buildRolePrompt(defaultRole("analyst"), { task, project: {}, round: 1, solo: false, brief: "## Brief\nB" });
    expect(a).toContain("<ceo_brief>\n## Brief\nB\n</ceo_brief>");
    const d = buildRolePrompt(defaultRole("developer"), {
      task,
      project: { aiPrompt: "bg" },
      round: 1,
      solo: false,
      brief: "BRIEF",
      spec: "SPEC",
    });
    expect(d).toContain("<specification>\nSPEC\n</specification>");
    expect(d).toContain("<project_background>\nbg\n</project_background>");
    expect(d).toContain(TESTING_INSTRUCTIONS);
    expect(d).not.toContain("qa_bug_list");
  });

  it("developer round 2 gets the bug list and the previous delivery note", () => {
    const d = buildRolePrompt(defaultRole("developer"), {
      task,
      project: {},
      round: 2,
      solo: false,
      spec: "SPEC",
      bugList: "1. broken",
      delivery: "## Teslim notu\nold",
    });
    expect(d).toContain("<qa_bug_list>\n1. broken\n</qa_bug_list>");
    expect(d).toContain("<previous_delivery_note>");
  });

  it("QA sees spec, delivery and a diff truncated to 30k", () => {
    const diff = "+".repeat(DIFF_CHAR_CAP + 10);
    const q = buildRolePrompt(defaultRole("qa"), {
      task,
      project: {},
      round: 1,
      solo: false,
      spec: "SPEC",
      delivery: "DELIVERY",
      diff,
      baseBranch: "main",
    });
    expect(q).toContain("git diff main...HEAD");
    expect(q).toContain(`[diff truncated to ${DIFF_CHAR_CAP} characters]`);
    expect((q.match(/\+/g) ?? []).length).toBe(DIFF_CHAR_CAP);
  });
});

describe("prompt size guard (A8e)", () => {
  const argvBytes = (args: string[]) => args.reduce((n, a) => n + Buffer.byteLength(a, "utf8") + 1, 0);

  it("a 300 KB specification is capped at 20k characters and the argv stays under 100 KiB", () => {
    const spec = "S".repeat(300_000);
    const role = defaultRole("developer");
    const prompt = buildRolePrompt(role, { task, project: {}, round: 1, solo: false, brief: "B", spec });
    expect(prompt).toContain(`[specification truncated to ${SECTION_CHAR_CAP} characters]`);
    expect((prompt.match(/S/g) ?? []).length).toBeLessThan(SECTION_CHAR_CAP + 100);
    const system = buildRoleSystemPrompt(role, 1, []).text;
    const args = buildClaudeArgs({ prompt, cwd: "/tmp", appendSystemPrompt: system, tools: role.tools });
    expect(argvBytes(args)).toBeLessThan(ARG_BYTES_LIMIT);
  });

  it("caps description, analysis, background, bug list and delivery too", () => {
    const big = "x".repeat(SECTION_CHAR_CAP + 500);
    const p = buildRolePrompt(defaultRole("developer"), {
      task: { title: "t", description: big, analysis: big },
      project: { aiPrompt: big },
      round: 2,
      solo: false,
      bugList: big,
      delivery: big,
    });
    for (const label of ["description", "analysis", "project_background", "qa_bug_list", "previous_delivery_note"]) {
      expect(p).toContain(`[${label} truncated to ${SECTION_CHAR_CAP} characters]`);
    }
    const solo = buildSoloPrompt({ task: { title: "t", description: big, analysis: "" }, project: { aiPrompt: big } });
    expect(solo).toContain(`[task truncated to ${SECTION_CHAR_CAP} characters]`);
    expect(solo).toContain(`[project_background truncated to ${SECTION_CHAR_CAP} characters]`);
  });

  it("buildClaudeArgs shrinks the largest blocks when capped sections still add up past 100 KiB", () => {
    const wide = "ç".repeat(SECTION_CHAR_CAP); // 2 bytes per char → 40 KB per section
    const prompt = buildRolePrompt(defaultRole("developer"), {
      task: { title: "t", description: wide, analysis: wide },
      project: { aiPrompt: wide },
      round: 2,
      solo: false,
      brief: wide,
      spec: wide,
      bugList: wide,
      delivery: wide,
    });
    expect(Buffer.byteLength(prompt, "utf8")).toBeGreaterThan(200 * 1024);
    const args = buildClaudeArgs({ prompt, cwd: "/tmp" });
    expect(args[0]).toBe("-p");
    expect(argvBytes(args)).toBeLessThanOrEqual(ARG_BYTES_LIMIT);
    expect(args[1]).toContain("to fit the CLI argument limit]");
    expect(args[1]).toContain(TESTING_INSTRUCTIONS);
    expect(args[1]).toContain("<qa_bug_list>");
  });

  it("throws prompt_too_large when there is no block left to shrink", () => {
    expect(() => buildClaudeArgs({ prompt: "y".repeat(200 * 1024), cwd: "/tmp" })).toThrow("prompt_too_large");
  });
});

describe("comment round prompt (E7b, plan §3/30)", () => {
  const dev = defaultRole("developer");
  const ctx = {
    task: { title: "Add slugify", description: "slugify helper for titles", analysis: "" },
    project: { aiPrompt: undefined },
    spec: "## Şartname\n\n- AC-1: slugify lowercases",
    qaReport: { verdict: "fail" as const, body: "## QA raporu\n\n- AC-1: ✗\n\nVERDICT: FAIL" },
    comment: "Please also strip emoji.",
  };

  it("carries the task, the last spec, the last QA verdict and the feedback tag", () => {
    const p = buildCommentPrompt(dev, { ...ctx, uiLang: "en" });
    expect(p).toContain("Title: Add slugify");
    expect(p).toContain("slugify helper for titles");
    expect(p).toContain("<specification>\n## Şartname");
    expect(p).toContain("Last QA verdict: FAIL");
    expect(p).toContain("VERDICT: FAIL");
    expect(p).toContain("<user_feedback>\nPlease also strip emoji.\n</user_feedback>");
    expect(p).toContain(TESTING_INSTRUCTIONS);
    expect(p).not.toContain("Kullanıcı şu geri bildirimi verdi");
  });

  it("asks for the reply in the GUI language (English by default)", () => {
    expect(buildCommentPrompt(dev, { ...ctx, uiLang: "tr" })).toContain("Write any reply in Türkçe.");
    expect(buildCommentPrompt(dev, { ...ctx, uiLang: "en" })).toContain("Write any reply in English.");
    expect(buildCommentPrompt(dev, ctx)).toContain("Write any reply in English.");
  });

  it("leaves out the spec and QA sections when the task has none (Solo)", () => {
    const p = buildCommentPrompt(dev, { ...ctx, spec: null, qaReport: null });
    expect(p).not.toContain("<specification>");
    expect(p).not.toContain("Last QA verdict");
    expect(p).toContain("<user_feedback>");
  });

  it("system prompt carries the comment marker instead of the developer role marker", () => {
    const marker = buildCommentSystemMarker(3);
    expect(marker).toBe("<!-- clauflow-role: comment round: 3 -->");
    const { text } = buildRoleSystemPrompt(dev, 3, [], { marker });
    expect(text.startsWith(marker)).toBe(true);
    expect(text).not.toContain(roleMarker("developer", 3));
    expect(text).toContain(dev.instructions);
    expect(buildRoleSystemPrompt(dev, 2).text.startsWith(roleMarker("developer", 2))).toBe(true);
  });
});
