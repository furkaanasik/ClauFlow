import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CLAUFLOW_DATA_DIR = `${process.env.TMPDIR ?? "/tmp"}/clauflow-rolerunner-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { costFromResult, RoleRunError, runRole } from "./roleRunner.js";
import { createProject, createTask, getNodeRun, getTask } from "../services/taskService.js";
import { FAKE_CLAUDE, readCalls } from "../test-utils/fakeRepo.js";

let dir = "";
let taskId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clauflow-role-"));
  const project = await createProject({ name: "Role", repoPath: dir, defaultBranch: "main", slug: "role" });
  taskId = (await createTask({ projectId: project.id, title: "role test" })).id;
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.FAKE_CLAUDE_STATE = mkdtempSync(join(tmpdir(), "clauflow-role-state-"));
  process.env.FAKE_CLAUDE_SCENARIO = "pass";
  delete process.env.FAKE_CLAUDE_COST_USD;
});

const base = () => ({
  taskId,
  cwd: dir,
  signal: new AbortController().signal,
  nodeId: "role:ceo:1",
  nodeType: "ceo" as const,
  prompt: "write a brief",
  appendSystemPrompt: "<!-- clauflow-role: ceo round: 1 -->",
  model: "sonnet",
  tools: ["Read", "Glob", "Grep"],
  isolate: true,
  budgetUsd: null,
  spentBeforeUsd: 0,
});

describe("runRole", () => {
  it("returns the result text, CLI cost and a finished node row", async () => {
    process.env.FAKE_CLAUDE_COST_USD = "0.25";
    const r = await runRole(base());
    expect(r.finalText).toContain("## Brief");
    expect(r.costUsd).toBeCloseTo(0.25, 6);
    expect(r.budgetExceeded).toBe(false);
    const row = getNodeRun(r.nodeRunId)!;
    expect(row).toMatchObject({ nodeId: "role:ceo:1", nodeType: "ceo", status: "done", model: "sonnet" });
    expect(row.inputTokens).toBe(100);
    const [call] = readCalls(process.env.FAKE_CLAUDE_STATE!);
    expect(call).toMatchObject({ model: "sonnet", tools: "Read,Glob,Grep", strictMcpConfig: true, settingSources: "project,local" });
    const task = await getTask(taskId);
    expect(task?.usage?.inputTokens).toBeGreaterThanOrEqual(100);
  });

  it("flags the budget as exceeded using the cumulative run cost", async () => {
    process.env.FAKE_CLAUDE_COST_USD = "0.5";
    const r = await runRole({ ...base(), budgetUsd: 1, spentBeforeUsd: 0.6 });
    expect(r.budgetExceeded).toBe(true);
    expect(r.finalText).toContain("## Brief");
  });

  it("throws a non-abort RoleRunError on CLI failure", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "exit_error";
    const err = await runRole(base()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoleRunError);
    expect((err as RoleRunError).aborted).toBe(false);
    expect((err as Error).message).toContain("exited 1");
  });

  it("throws an abort RoleRunError when the parent is aborted", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "slow";
    process.env.FAKE_CLAUDE_SLOW_MS = "20000";
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 300);
    const err = await runRole({ ...base(), signal: ctrl.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoleRunError);
    expect((err as RoleRunError).aborted).toBe(true);
  });
});

describe("costFromResult", () => {
  it("prefers total_cost_usd, then modelUsage, then token pricing", () => {
    expect(costFromResult({ total_cost_usd: 0.4, modelUsage: { a: { costUSD: 9 } } }, "sonnet")).toBe(0.4);
    expect(costFromResult({ modelUsage: { a: { costUSD: 0.1 }, b: { costUSD: 0.2 } } }, "sonnet")).toBeCloseTo(0.3, 6);
    expect(costFromResult({ usage: { input_tokens: 1_000_000 } }, "sonnet")).toBeCloseTo(3, 6);
    expect(costFromResult(null, "sonnet")).toBeNull();
  });
});
