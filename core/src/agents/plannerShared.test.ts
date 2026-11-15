import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CLAUFLOW_DATA_DIR = `${process.env.TMPDIR ?? "/tmp"}/clauflow-planner-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractJsonArray,
  normalizeTasks,
  plannerCostFromStdout,
  runPlannerCli,
} from "./plannerShared.js";
import { buildPlannerPrompt, runProjectPlanner } from "./projectPlanner.js";
import { runTaskBreakdown } from "./taskBreakdownRunner.js";
import { createProject, createTask, getProject, getTask, listTasks } from "../services/taskService.js";
import { FAKE_CLAUDE, makeRepo, readCalls } from "../test-utils/fakeRepo.js";

const CLAUFLOW_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dirs: string[] = [];

beforeEach(() => {
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
  const state = mkdtempSync(join(tmpdir(), "clauflow-planner-state-"));
  dirs.push(state);
  process.env.FAKE_CLAUDE_STATE = state;
  process.env.FAKE_CLAUDE_SCENARIO = "pass";
  delete process.env.FAKE_CLAUDE_COST_USD;
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("extractJsonArray", () => {
  it("reads the array from a JSON envelope's result field", () => {
    const env = JSON.stringify({ type: "result", result: '[{"title":"a"}]', total_cost_usd: 0.1 });
    expect(extractJsonArray(env)).toEqual([{ title: "a" }]);
  });

  it("strips code fences and surrounding prose", () => {
    expect(extractJsonArray('```json\n[{"title":"x"}]\n```')).toEqual([{ title: "x" }]);
    expect(extractJsonArray('Here you go: [{"title":"y"}] done')).toEqual([{ title: "y" }]);
  });

  it("recovers the complete objects of a truncated reply", () => {
    expect(extractJsonArray('[{"title":"ok","tags":["a"]},{"title":"cut off')).toEqual([
      { title: "ok", tags: ["a"] },
    ]);
  });

  it("throws on an error envelope and on empty or array-less replies", () => {
    expect(() => extractJsonArray(JSON.stringify({ is_error: true, result: "boom" }))).toThrow(/error envelope/);
    expect(() => extractJsonArray("   ")).toThrow(/empty/);
    expect(() => extractJsonArray("no json here")).toThrow(/did not contain a JSON array/);
  });
});

describe("normalizeTasks", () => {
  it("trims, caps titles at 80, defaults priority and analysis, caps tags and count", () => {
    const items = normalizeTasks(
      [
        { title: `  ${"t".repeat(100)}  `, description: " d ", priority: "HIGH", tags: [" a ", "", 3, "b".repeat(40)] },
        { title: "second", priority: "urgent", analysis: "deep" },
        { title: "   " },
        "junk",
        { title: "third" },
      ],
      2,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "t".repeat(80),
      description: "d",
      analysis: "d",
      priority: "high",
      tags: ["a", "b".repeat(32)],
    });
    expect(items[1]).toMatchObject({ title: "second", priority: "medium", analysis: "deep", tags: [] });
  });

  it("rejects non-arrays and arrays without a usable task", () => {
    expect(() => normalizeTasks({}, 5)).toThrow(/not a JSON array/);
    expect(() => normalizeTasks([{ title: "" }], 5)).toThrow(/no usable tasks/);
  });
});

describe("runPlannerCli (A7a)", () => {
  it("restricts a repo run to read-only tools and isolates it like the roles", async () => {
    const repo = makeRepo("clauflow-planner-repo-");
    dirs.push(repo);
    process.env.FAKE_CLAUDE_COST_USD = "0.07";
    const r = await runPlannerCli({ prompt: "Return ONLY a JSON array", cwd: repo });
    expect(r.code).toBe(0);
    expect(r.costUsd).toBeCloseTo(0.07, 9);
    const [call] = readCalls(process.env.FAKE_CLAUDE_STATE!);
    expect(call).toMatchObject({
      cwd: repo,
      tools: "Read,Glob,Grep",
      allowedTools: null,
      strictMcpConfig: true,
      settingSources: "project,local",
      outputFormat: "json",
      permissionMode: "bypassPermissions",
    });
    expect((call!.argv as string[])[0]).toBe("-p");
    expect(call!.argv as string[]).not.toContain("--allowedTools");
  });

  it("without a repo runs with no tools in an empty temp dir, not ClauFlow's folder", async () => {
    await runPlannerCli({ prompt: "Return ONLY a JSON array", cwd: null });
    const [call] = readCalls(process.env.FAKE_CLAUDE_STATE!);
    expect(call!.tools).toBe("");
    const argv = call!.argv as string[];
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    const cwd = resolve(call!.cwd as string);
    expect(cwd.startsWith(CLAUFLOW_ROOT)).toBe(false);
    expect(cwd).not.toBe(resolve(process.cwd()));
    expect(cwd.startsWith(resolve(tmpdir()))).toBe(true);
  });

  it("reads the cost from the JSON envelope, 0 when missing", () => {
    expect(plannerCostFromStdout(JSON.stringify({ total_cost_usd: 0.3 }))).toBeCloseTo(0.3, 9);
    expect(plannerCostFromStdout("[1,2]")).toBe(0);
    expect(plannerCostFromStdout("{broken")).toBe(0);
  });
});

describe("planner prompt (A7b)", () => {
  it("does not leak ClauFlow-specific paths, services or limits", () => {
    for (const repoExists of [true, false]) {
      const p = buildPlannerPrompt({ aiPrompt: "A todo app", cap: 5, repoExists });
      expect(p).not.toMatch(/src\/agents|src\/services|claudeService|runClaude|6000/);
      expect(p).toContain("at most 5");
    }
  });
});

describe("planner and breakdown cost (F3)", () => {
  it("adds the planner's total_cost_usd to the project, not to a task", async () => {
    const repo = makeRepo("clauflow-planner-proj-");
    dirs.push(repo);
    const project = await createProject({ name: "Plan", repoPath: repo, defaultBranch: "main", slug: "plan" });
    process.env.FAKE_CLAUDE_COST_USD = "0.11";
    await runProjectPlanner(project.id, "Build a thing", 5);
    const after = await getProject(project.id);
    expect(after!.planningStatus).toBe("done");
    expect(after!.planningCostUsd).toBeCloseTo(0.11, 9);
    const tasks = (await listTasks()).filter((t) => t.projectId === project.id);
    expect(tasks.map((t) => t.title)).toEqual(["Fake task one", "Fake task two"]);
    expect(tasks.every((t) => t.costUsd === 0)).toBe(true);
  });

  it("adds the breakdown's total_cost_usd to the parent task", async () => {
    const repo = makeRepo("clauflow-planner-bd-");
    dirs.push(repo);
    const project = await createProject({ name: "Breakdown", repoPath: repo, defaultBranch: "main", slug: "bd" });
    const parent = await createTask({ projectId: project.id, title: "Big task" });
    process.env.FAKE_CLAUDE_COST_USD = "0.09";
    await runTaskBreakdown(parent.id, "Split it", 4);
    const p = await getTask(parent.id);
    expect(p!.costUsd).toBeCloseTo(0.09, 9);
    const children = (await listTasks()).filter((t) => t.parentTaskId === parent.id);
    expect(children).toHaveLength(2);
    expect(children.every((t) => t.costUsd === 0)).toBe(true);
    const [call] = readCalls(process.env.FAKE_CLAUDE_STATE!);
    expect(call).toMatchObject({ tools: "Read,Glob,Grep", strictMcpConfig: true, settingSources: "project,local" });
  });
});
