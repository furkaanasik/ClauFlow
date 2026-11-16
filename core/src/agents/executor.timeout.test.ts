import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-extimeout-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-extimeout-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { abort, run as runExecutor } from "./executor.js";
import { createTask, getProject, getTask, listNodeRunsByTask, updateTask } from "../services/taskService.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { liveProcessGroups } from "../services/claudeService.js";
import { git, processGone, readHangPids } from "../test-utils/fakeRepo.js";
import { RoleRunError, RoleTimeoutError, roleTimeoutMs } from "./roleRunner.js";
import { runErrorCode } from "./runErrorCode.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await sleep(20);
  }
}

async function expectTreeGone(state: string): Promise<void> {
  const pids = readHangPids(state);
  expect(pids).not.toBeNull();
  await until(() => processGone(pids!.cli) && processGone(pids!.grandchild), 2000);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

describe("role timeout (E7a, plan §3/29)", () => {
  it("a hanging Solo developer times out: stuck path, wip commit, branch kept, lock free, tree dead", async () => {
    vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", "300");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "200");
    const c = await makeTeamCase({ scenario: "hang", project: { defaultTeamId: null } });

    const t = await runTeamCase(c, { uiLang: "tr" });
    expect(t.status).toBe("todo");
    expect(t.agent.status).toBe("error");
    expect(t.agent.error).toBe("role_timeout:developer");

    const v = inspect(c);
    expect(v.currentBranch).toBe("main");
    expect(v.status).toBe("");
    expect(v.branches).toHaveLength(1);
    const branch = v.branches[0]!;
    expect(t.branch).toBe(branch);
    expect(v.branchLog(branch)[0]).toMatch(/^wip: .*takıldı \(.*zaman aşımına uğradı \(1 sn\)\)/);
    expect(v.branchFiles(branch)).toEqual(["fake-1.txt"]);
    expect(getRepoLockHolder(c.repo)).toBeNull();
    await expectTreeGone(c.state);
    expect(liveProcessGroups()).toEqual([]);

    expect(v.runs).toHaveLength(1);
    expect(v.runs[0]!.status).toBe("stuck");
    expect(v.runs[0]!.stopReason).toBe("timeout");
    expect(v.artifacts.map((a) => a.kind)).toEqual(expect.arrayContaining(["stuck", "summary"]));
    const nodeRun = listNodeRunsByTask(c.task.id).find((n) => n.nodeId === "role:developer:1")!;
    expect(nodeRun.status).toBe("error");
    expect(nodeRun.errorMessage).toBe("role_timeout");
    expect(t.agent.log.join("\n")).toMatch(/Zaman aşımı: developer/);
  });

  it("a task queued on the same repo gets the lock after the timeout and reaches review", async () => {
    vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", "300");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "200");
    const c = await makeTeamCase({ scenario: "hang", project: { defaultTeamId: null } });
    const second = await createTask({ projectId: c.project.id, title: "Second task" });
    const project = (await getProject(c.project.id))!;

    const runA = runExecutor(await updateTask(c.task.id, { status: "doing" }), project);
    await until(() => readHangPids(c.state) !== null);
    // The second run spawns its CLI only after the first released the lock.
    process.env.FAKE_CLAUDE_SCENARIO = "pass";
    const runB = runExecutor(await updateTask(second.id, { status: "doing" }), project);
    await Promise.all([runA, runB]);

    const a = (await getTask(c.task.id))!;
    const b = (await getTask(second.id))!;
    expect(a.agent.error).toBe("role_timeout:developer");
    expect(b.status).toBe("review");
    expect(b.agent.status).toBe("done");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(getRepoLockHolder(c.repo)).toBeNull();
    await expectTreeGone(c.state);
  });

  it("a user abort before the timeout wins: aborted_by_user", async () => {
    vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", "5000");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "200");
    const c = await makeTeamCase({ scenario: "hang", project: { defaultTeamId: null } });
    const pending = runTeamCase(c);
    await until(() => readHangPids(c.state) !== null);

    const started = Date.now();
    expect(abort(c.task.id)).toBe(true);
    const t = await pending;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(t.status).toBe("todo");
    expect(t.agent.error).toBe("aborted_by_user");
    expect(inspect(c).runs[0]!.status).toBe("aborted");
    expect(getRepoLockHolder(c.repo)).toBeNull();
    await expectTreeGone(c.state);
  });
});

describe("roleTimeoutMs and RoleTimeoutError", () => {
  it("reads CLAUFLOW_ROLE_TIMEOUT_MS and falls back to 20 minutes", () => {
    vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", "1500");
    expect(roleTimeoutMs()).toBe(1500);
    for (const bad of ["", "abc", "0", "-5"]) {
      vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", bad);
      expect(roleTimeoutMs()).toBe(20 * 60 * 1000);
    }
  });

  it("is a non-abort RoleRunError whose code runErrorCode passes through unchanged", () => {
    const err = new RoleTimeoutError("qa");
    expect(err).toBeInstanceOf(RoleRunError);
    expect(err.aborted).toBe(false);
    expect(err.message).toBe("role_timeout:qa");
    expect(runErrorCode(err)).toBe("role_timeout:qa");
  });
});
