import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-teamrun-b-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-teamrun-b-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { abort } from "./executor.js";
import { getTask, updateTask, getProject } from "../services/taskService.js";
import { readCalls } from "../test-utils/fakeRepo.js";
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
    expect(task.agent.error).toMatch(/^Takıldı: QA arka arkaya iki kez/);
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
    expect(task.agent.error).toBe("Takıldı: QA tur sınırına ulaşıldı (2)");
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
    expect(task.agent.error).toBe("Takıldı: Bütçe aşıldı ($1.20 / $1.00)");
    expect(task.status).toBe("todo");
    expect(r.currentBranch).toBe("main");
    expect(r.status).toBe("");
    const log = r.branchLog(task.branch!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^wip: /);
    expect(r.branchFiles(task.branch!)).toEqual(["fake-1.txt"]);
    expect(r.artifacts.find((a) => a.kind === "delivery")!.commitSha).toBeNull();
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
    expect(task.agent.error).toMatch(/^Kullanıcı tarafından durduruldu/);
    expect(r.runs[0]).toMatchObject({ status: "aborted", stopReason: "aborted" });
    expect(r.branches).toEqual([]);
    expect(r.currentBranch).toBe("main");
  });
});
