import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-exlock-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-exlock-gh-${stamp}`;
});

import { existsSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { abort, isRunning, run as runExecutor, runPhase } from "./executor.js";
import { createProject, createTask, getProject, getTask, updateTask } from "../services/taskService.js";
import { git, readCalls } from "../test-utils/fakeRepo.js";
import { startTestServer } from "../test-utils/httpApp.js";
import { cleanupTeamCases, makeTeamCase } from "../test-utils/teamHarness.js";
import tasksRouter from "../routes/tasks.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await sleep(20);
  }
}

afterEach(() => {
  delete process.env.FAKE_CLAUDE_SLOW_MS;
});

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("executor repo lock (A1a–A1c)", () => {
  it("a second task on the same repo (via a symlinked project) waits for the first and never touches its tree", async () => {
    process.env.FAKE_CLAUDE_SLOW_MS = "700";
    const c = await makeTeamCase({ scenario: "slow", project: { defaultTeamId: null } });
    const alias = `${c.repo}-alias`;
    symlinkSync(c.repo, alias);
    const otherProject = await createProject({
      name: "alias project",
      repoPath: alias,
      defaultBranch: "main",
      slug: `alias${Date.now().toString(36)}`,
      defaultTeamId: null,
    });
    const second = await createTask({ projectId: otherProject.id, title: "Second task" });

    const a = await updateTask(c.task.id, { status: "doing" });
    const b = await updateTask(second.id, { status: "doing" });
    const runA = runExecutor(a, (await getProject(c.project.id))!);
    const runB = runExecutor(b, (await getProject(otherProject.id))!);

    await until(() => readCalls(c.state).length === 1);
    expect(runPhase(c.task.id)).toBe("running");
    expect(runPhase(second.id)).toBe("queued");
    const aBranch = (await getTask(c.task.id))!.branch!;
    await sleep(300);
    expect(readCalls(c.state)).toHaveLength(1);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe(aBranch);
    expect(existsSync(join(c.repo, "fake-1.txt"))).toBe(true);
    expect((await getTask(second.id))!.agent.status).toBe("idle");

    await Promise.all([runA, runB]);
    rmSync(alias);

    const doneA = (await getTask(c.task.id))!;
    const doneB = (await getTask(second.id))!;
    expect(doneA.agent.status).toBe("done");
    expect(doneB.agent.status).toBe("done");
    expect(readCalls(c.state)).toHaveLength(2);
    expect(git(c.repo, "log", "--format=%s", `main..${aBranch}`)).toMatch(/^feat/);
    expect(git(c.repo, "diff", "--name-only", `main...${aBranch}`)).toBe("fake-1.txt");
    expect(git(c.repo, "diff", "--name-only", `main...${doneB.branch}`)).toBe("fake-1.txt");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(isRunning(c.task.id) || isRunning(second.id)).toBe(false);
  });
});

describe("abort and retry (A1d, A1e)", () => {
  it("aborting a queued task returns it to todo without any git work", async () => {
    process.env.FAKE_CLAUDE_SLOW_MS = "600";
    const c = await makeTeamCase({ scenario: "slow", project: { defaultTeamId: null } });
    const queued = await createTask({ projectId: c.project.id, title: "Queued task" });
    const project = (await getProject(c.project.id))!;
    const runA = runExecutor(await updateTask(c.task.id, { status: "doing" }), project);
    await until(() => readCalls(c.state).length === 1);
    const runB = runExecutor(await updateTask(queued.id, { status: "doing" }), project);
    await sleep(20);
    expect(runPhase(queued.id)).toBe("queued");
    const aBranch = (await getTask(c.task.id))!.branch!;

    expect(abort(queued.id)).toBe(true);
    await runB;
    const b = (await getTask(queued.id))!;
    expect(b.status).toBe("todo");
    expect(b.agent.status).toBe("error");
    expect(b.agent.error).toBe("aborted_by_user");
    expect(b.branch ?? null).toBeNull();
    expect(b.agent.log.join("\n")).not.toMatch(/Cleaned up|checkout/);
    expect(runPhase(c.task.id)).toBe("running");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe(aBranch);
    expect(existsSync(join(c.repo, "fake-1.txt"))).toBe(true);

    await runA;
    expect((await getTask(c.task.id))!.agent.status).toBe("done");
    expect(git(c.repo, "branch", "--list", "feature/*").split("\n")).toHaveLength(1);
  });

  it("a late finally of an aborted run does not drop the newer run or roll its task back", async () => {
    process.env.FAKE_CLAUDE_SLOW_MS = "30000";
    const c = await makeTeamCase({ scenario: "slow", project: { defaultTeamId: null } });
    const project = (await getProject(c.project.id))!;
    const doing = await updateTask(c.task.id, { status: "doing" });
    const first = runExecutor(doing, project);
    await until(() => readCalls(c.state).length === 1);

    abort(c.task.id);
    process.env.FAKE_CLAUDE_SCENARIO = "pass";
    const second = runExecutor(doing, project);
    await first;

    expect(isRunning(c.task.id)).toBe(true);
    expect((await getTask(c.task.id))!.status).toBe("doing");
    await second;
    const t = (await getTask(c.task.id))!;
    expect(t.agent.status).toBe("done");
    expect(t.agent.error ?? null).toBeNull();
    expect(isRunning(c.task.id)).toBe(false);
  });

  it("POST /retry aborts the live run, waits for it and re-runs the task in doing", async () => {
    process.env.FAKE_CLAUDE_SLOW_MS = "30000";
    const c = await makeTeamCase({ scenario: "slow", project: { defaultTeamId: null } });
    const server = await startTestServer([["/api/tasks", tasksRouter]]);
    try {
      const patch = await fetch(`${server.url}/api/tasks/${c.task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "doing" }),
      });
      expect(patch.status).toBe(200);
      await until(() => readCalls(c.state).length === 1);
      process.env.FAKE_CLAUDE_SCENARIO = "pass";
      const retry = await fetch(`${server.url}/api/tasks/${c.task.id}/retry`, { method: "POST" });
      expect(retry.status).toBe(200);
      const body = (await retry.json()) as { task: { status: string } };
      expect(body.task.status).toBe("doing");
      await until(async () => (await getTask(c.task.id))!.agent.status === "done");
      expect(readCalls(c.state)).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
});

describe("error cleanup only on the run's own branch (A1b)", () => {
  it("an error before the branch exists leaves the working tree, HEAD and branches alone", async () => {
    const c = await makeTeamCase({
      scenario: "pass",
      project: { defaultTeamId: null, defaultBranch: "does-not-exist" },
    });
    git(c.repo, "checkout", "-q", "-b", "someone-else");
    writeFileSync(join(c.repo, "README.md"), "# edited by another run\n");
    writeFileSync(join(c.repo, "untracked.txt"), "keep me\n");

    const doing = await updateTask(c.task.id, { status: "doing" });
    await runExecutor(doing, (await getProject(c.project.id))!);

    const t = (await getTask(c.task.id))!;
    expect(t.status).toBe("todo");
    // zincir F0.5: the base-branch precheck now catches this before any git write.
    expect(t.agent.error).toBe("base_branch_missing:someone-else");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("someone-else");
    expect(git(c.repo, "status", "--porcelain")).toBe("M README.md\n?? untracked.txt");
    expect(readCalls(c.state)).toHaveLength(0);
  });
});
