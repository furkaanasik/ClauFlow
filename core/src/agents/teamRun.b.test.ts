import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-teamrun-b-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-teamrun-b-gh-${stamp}`;
});

import { rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { attachWebSocket, closeWebSocket } from "../services/wsService.js";
import { join } from "node:path";
import { abort } from "./executor.js";
import { getTask, updateTask, getProject } from "../services/taskService.js";
import { git, readCalls } from "../test-utils/fakeRepo.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";
import { run as runExecutor } from "./executor.js";

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SLOW_MS;
});

describe("team run B: stop paths", () => {
  it("stuck: same bug list twice stops the run, keeps the branch and returns to main", async () => {
    const c = await makeTeamCase({ scenario: "stuck" });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1", "developer:2", "qa:2"]);
    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(task.agent.error).toBe("stuck_stalled");
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "stalled", qaRound: 2 });
    expect(r.currentBranch).toBe("main");
    expect(r.status).toBe("");
    expect(r.branches).toEqual([task.branch]);
    expect(r.branchLog(task.branch!)).toHaveLength(2);
    expect(r.artifacts.map((a) => a.kind).slice(-2)).toEqual(["stuck", "summary"]);
    expect(r.artifacts.find((a) => a.kind === "stuck")!.body).toContain("AC-1 is not met");
    const comment = r.comments.find((x) => x.body.startsWith("## Ekip özeti"))!;
    expect(comment.body).toContain("Takıldı");
  });

  it("always_fail with a limit of 2 stops on the round limit, not as stalled", async () => {
    const c = await makeTeamCase({ scenario: "always_fail", project: { qaMaxRounds: 2 } });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1", "developer:2", "qa:2"]);
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "round_limit", qaRound: 2 });
    expect(task.agent.error).toBe("stuck_round_limit");
    expect(task.status).toBe("todo");
  });

  it("unlimited rounds still stop on stalled", async () => {
    const c = await makeTeamCase({ scenario: "stuck", project: { qaMaxRounds: 0 } });
    await runTeamCase(c);
    const r = inspect(c);
    expect(r.roles).toHaveLength(6);
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "stalled" });
  });

  it("unlimited rounds keep looping while the bug list changes", async () => {
    const c = await makeTeamCase({ scenario: "always_fail", project: { qaMaxRounds: 0 }, budgetUsd: 0.5, costUsd: 0.05 });
    await runTeamCase(c);
    const r = inspect(c);
    expect(r.roles.filter((x) => x.startsWith("qa")).length).toBeGreaterThan(3);
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "budget" });
  });

  it("budget: cumulative role cost stops the run and keeps unfinished work as a wip commit", async () => {
    const c = await makeTeamCase({ scenario: "pass", budgetUsd: 1, costUsd: 0.4 });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1"]);
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "budget" });
    expect(r.runs[0]!.costUsd).toBeCloseTo(1.2, 6);
    expect(task.agent.error).toBe("stuck_budget");
    expect(task.status).toBe("todo");
    expect(r.currentBranch).toBe("main");
    expect(r.status).toBe("");
    const log = r.branchLog(task.branch!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^wip: /);
    expect(r.branchFiles(task.branch!)).toEqual(["fake-1.txt"]);
    expect(r.artifacts.find((a) => a.kind === "delivery")!.commitSha).toBeNull();
  });

  it("Solo over budget stops as stuck/budget with a wip commit, never a feat commit or done (A3)", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null }, budgetUsd: 0.3, costUsd: 0.4 });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["developer:1"]);
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "budget" });
    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(task.agent.error).toBe("stuck_budget");
    expect(task.prUrl ?? null).toBeNull();
    expect(r.currentBranch).toBe("main");
    expect(r.status).toBe("");
    const log = r.branchLog(task.branch!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^wip: /);
    expect(r.branchFiles(task.branch!)).toEqual(["fake-1.txt"]);
  });

  it("budget_exceeded carries spent/budget plus task and project names for the toast (A8d)", async () => {
    const server = http.createServer();
    attachWebSocket(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`);
    const frames: Array<{ type: string; taskId?: string; payload?: unknown }> = [];
    ws.on("message", (d) => frames.push(JSON.parse(String(d))));
    await new Promise<void>((r) => ws.once("open", () => r()));
    try {
      const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null }, budgetUsd: 0.3, costUsd: 0.4 });
      await runTeamCase(c);
      for (let i = 0; i < 50 && !frames.some((f) => f.type === "budget_exceeded"); i++) await new Promise((r) => setTimeout(r, 20));
      const frame = frames.find((f) => f.type === "budget_exceeded")!;
      expect(frame.taskId).toBe(c.task.id);
      expect(frame.payload).toEqual({
        spentUsd: 0.4,
        budgetUsd: 0.3,
        taskTitle: c.task.title,
        displayId: c.task.displayId ?? null,
        projectId: c.project.id,
        projectName: c.project.name,
      });
    } finally {
      ws.close();
      await closeWebSocket();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("a QA PASS turn that crosses the budget still delivers (A3 exception)", async () => {
    const c = await makeTeamCase({ scenario: "pass", budgetUsd: 1, costUsd: 0.3 });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1"]);
    expect(r.runs[0]).toMatchObject({ status: "delivered", stopReason: null });
    expect(r.runs[0]!.costUsd).toBeGreaterThanOrEqual(1);
    expect(task.agent.status).toBe("done");
    expect(task.agent.error ?? null).toBeNull();
    expect(r.branchLog(task.branch!)[0]).toMatch(/^feat/);
  });

  it("a retry keeps the stuck run's branch as <branch>-wip-1 instead of deleting it (A4)", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null }, budgetUsd: 0.3, costUsd: 0.4 });
    const stuck = await runTeamCase(c);
    const branch = stuck.branch!;
    const wipSha = git(c.repo, "rev-parse", branch);

    await updateTask(c.task.id, { budgetUsd: 5 });
    const retried = await runTeamCase(c);
    const r = inspect(c);

    expect(retried.agent.status).toBe("done");
    expect(retried.branch).toBe(branch);
    expect(r.branches.sort()).toEqual([branch, `${branch}-wip-1`].sort());
    expect(git(c.repo, "rev-parse", `${branch}-wip-1`)).toBe(wipSha);
    expect(r.branchLog(`${branch}-wip-1`)[0]).toMatch(/^wip: /);
    expect(r.branchLog(branch)[0]).toMatch(/^feat/);
    expect(retried.agent.log.join("\n")).toContain(`${branch}-wip-1`);

    // A further retry picks the next free suffix.
    await updateTask(c.task.id, { budgetUsd: 0.3 });
    await runTeamCase(c);
    await updateTask(c.task.id, { budgetUsd: 5 });
    await runTeamCase(c);
    expect(inspect(c).branches).toContain(`${branch}-wip-2`);
  });

  it("role discard stashes carry run/role/round and are dropped when the run delivers (A8c)", async () => {
    process.env.FAKE_CLAUDE_DIRTY_ROLES = "ceo,qa";
    try {
      const c = await makeTeamCase({
        scenario: "pass",
        setupRepo: (repo) => {
          writeFileSync(join(repo, "mine.txt"), "user work\n");
          git(repo, "stash", "push", "-u", "-m", "user-keep");
        },
      });
      const task = await runTeamCase(c);
      const r = inspect(c);
      expect(r.runs[0]!.status).toBe("delivered");
      const stashes = git(c.repo, "stash", "list");
      expect(stashes).not.toContain("clauflow-discard-");
      expect(stashes).toContain("user-keep");
      expect(task.agent.log.join("\n")).toContain(`clauflow-discard-${r.runs[0]!.id}-ceo-1`);
      expect(r.branchFiles(task.branch!)).toEqual(["fake-1.txt"]);
    } finally {
      delete process.env.FAKE_CLAUDE_DIRTY_ROLES;
    }
  });

  it("a stuck run keeps its discard stashes for inspection (A8c)", async () => {
    process.env.FAKE_CLAUDE_DIRTY_ROLES = "qa";
    try {
      const c = await makeTeamCase({ scenario: "stuck" });
      await runTeamCase(c);
      const runId = inspect(c).runs[0]!.id;
      const stashes = git(c.repo, "stash", "list");
      expect(stashes).toContain(`clauflow-discard-${runId}-qa-1`);
      expect(stashes).toContain(`clauflow-discard-${runId}-qa-2`);
    } finally {
      delete process.env.FAKE_CLAUDE_DIRTY_ROLES;
    }
  });

  it("budget is checked before a role starts", async () => {
    const c = await makeTeamCase({ scenario: "pass", budgetUsd: 0.5, costUsd: 0.5 });
    await runTeamCase(c);
    const r = inspect(c);
    expect(r.roles).toEqual(["ceo:1"]);
    expect(r.runs[0]).toMatchObject({ status: "stuck", stopReason: "budget" });
  });

  it("exit_error follows today's error path: todo + error, branch dropped", async () => {
    const c = await makeTeamCase({ scenario: "exit_error" });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["ceo:1"]);
    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(task.agent.error).toContain("claude CLI exited 1");
    expect(r.runs[0]!.status).toBe("error");
    expect(r.branches).toEqual([]);
    expect(r.currentBranch).toBe("main");
  });

  it("slow + abort: user abort kills the role, marks the run aborted and cleans up", async () => {
    process.env.FAKE_CLAUDE_SLOW_MS = "30000";
    const c = await makeTeamCase({ scenario: "slow" });
    const doing = await updateTask(c.task.id, { status: "doing" });
    const running = runExecutor(doing, (await getProject(c.project.id))!);
    for (let i = 0; i < 100 && readCalls(c.state).length === 0; i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(abort(c.task.id)).toBe(true);
    await running;
    delete process.env.FAKE_CLAUDE_SLOW_MS;

    const task = (await getTask(c.task.id))!;
    const r = inspect(c);
    expect(task.status).toBe("todo");
    expect(task.agent.error).toBe("aborted_by_user");
    expect(r.runs[0]).toMatchObject({ status: "aborted", stopReason: "aborted" });
    expect(r.branches).toEqual([]);
    expect(r.currentBranch).toBe("main");
  });
});
