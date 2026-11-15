import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-nochange-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-nochange-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { getComments } from "../services/commentService.js";
import { createTask, getTask, updateTask } from "../services/taskService.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";
import { closeBrokenDownParent } from "./taskBreakdownRunner.js";

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("no `nothing` status (C1)", () => {
  it("a run with no changes closes the task as done, drops the branch and explains why", async () => {
    const c = await makeTeamCase({ scenario: "no_change", project: { defaultTeamId: null } });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(task.status).toBe("done");
    expect(task.branch).toBeNull();
    expect(task.agent.status).toBe("done");
    expect(r.currentBranch).toBe("main");
    expect(r.branches).toEqual([]);
    expect(r.comments.some((x) => x.body.startsWith("No changes needed"))).toBe(true);
  });

  it("breakdown closes a non-running parent as done with a subtask-count comment", async () => {
    const c = await makeTeamCase({});
    await closeBrokenDownParent(c.task.id, 3, "tr");
    const parent = (await getTask(c.task.id))!;
    expect(parent.status).toBe("done");
    expect(getComments(c.task.id).map((x) => x.body)).toEqual(["3 alt göreve bölündü."]);
  });

  it("breakdown leaves a running (doing) parent's status alone", async () => {
    const c = await makeTeamCase({});
    await updateTask(c.task.id, { status: "doing" });
    await closeBrokenDownParent(c.task.id, 2);
    expect((await getTask(c.task.id))!.status).toBe("doing");
    expect(getComments(c.task.id).map((x) => x.body)).toEqual(["Split into 2 subtasks."]);
  });

  it("breakdown with zero subtasks changes nothing", async () => {
    const c = await makeTeamCase({});
    const other = await createTask({ projectId: c.project.id, title: "x" });
    await closeBrokenDownParent(other.id, 0);
    expect((await getTask(other.id))!.status).toBe("todo");
    expect(getComments(other.id)).toEqual([]);
  });
});
