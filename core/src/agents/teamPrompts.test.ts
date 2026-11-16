import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillCatalogRoots } from "../services/skillCatalogService.js";
import { defaultRole } from "../services/teamTemplates.js";
import { buildClaudeArgs } from "../services/claudeService.js";
import {
  buildConflictPrompt,
  buildConflictResolutionBlock,
  buildConflictSystemMarker,
  CONFLICT_FILE_CHAR_CAP,
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
  it("a 300 KB specification reaches the prompt intact and stays out of argv", () => {
    const spec = "S".repeat(300_000);
    const role = defaultRole("developer");
    const prompt = buildRolePrompt(role, { task, project: {}, round: 1, solo: false, brief: "B", spec });
    expect(prompt).not.toContain("truncated");
    expect(prompt).toContain(spec);
    const system = buildRoleSystemPrompt(role, 1, []).text;
    const args = buildClaudeArgs({ prompt, cwd: "/tmp", appendSystemPrompt: system, tools: role.tools });
    expect(args[0]).toBe("-p");
    expect(args.some((a) => a.includes(spec.slice(0, 1000)))).toBe(false);
  });

  it("still caps description, analysis, background, bug list and delivery past the sanity cap", () => {
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

  it("buildClaudeArgs never carries the prompt, however large", () => {
    const prompt = "y".repeat(200 * 1024);
    const args = buildClaudeArgs({ prompt, cwd: "/tmp" });
    expect(args).toEqual(["-p", "--permission-mode", "bypassPermissions"]);
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

describe("conflict resolver prompt (zincir F4.6, §3/35–36)", () => {
  const block = (n: number) => `<<<<<<< HEAD\n${"o".repeat(n)}\n=======\ntheirs\n>>>>>>> main`;
  it("task, merged work, conflicted hunks, rules and language; oversized files by name only", () => {
    const prompt = buildConflictPrompt({
      task: { title: "Greet from B", description: "B greets.", analysis: "" },
      project: { aiPrompt: "" },
      spec: "## Şartname\nAC-1",
      target: "origin/main",
      branch: "feature/clf-2-b",
      mergedTasks: [{ displayId: "CLF-1", title: "Greet from A", description: "A greets." }],
      conflicts: [
        { path: "shared.txt", text: block(5) },
        { path: "huge.txt", text: block(CONFLICT_FILE_CHAR_CAP + 10) },
      ],
      uiLang: "tr",
    });
    expect(prompt).toContain("Title: Greet from B");
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("<merged_into_base>\nCLF-1 · Greet from A\nA greets.\n</merged_into_base>");
    expect(prompt).toContain("File: shared.txt\n@@ lines 1-5 @@\n<<<<<<< HEAD");
    expect(prompt).toContain("File: huge.txt\n(conflict too large to include here; open the file)");
    expect(prompt).toContain("Keep BOTH intents");
    expect(prompt).toContain("Do NOT run git commit, merge, rebase, reset, checkout, stash or push");
    expect(prompt).toContain("Write the note in Türkçe.");
    expect(buildConflictPrompt({
      task: { title: "t", description: "", analysis: "" },
      project: {},
      target: "main",
      branch: "b",
      mergedTasks: [],
      conflicts: [{ path: "a.txt", text: block(1) }],
    })).not.toContain("<merged_into_base>");
  });

  it("marker and the QA block", () => {
    expect(buildConflictSystemMarker(3)).toBe("<!-- clauflow-role: conflict_resolver round: 3 -->");
    const qa = buildConflictResolutionBlock("main", ["shared.txt"], "- shared.txt: kept both");
    expect(qa).toContain("<conflict_resolution>\nConflicted files:\n- shared.txt");
    expect(qa).toContain("- shared.txt: kept both\n</conflict_resolution>");
  });
});
