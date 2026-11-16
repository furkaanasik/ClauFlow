import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-exec-basebranch-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-exec-basebranch-gh-${stamp}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runExecutor } from "./executor.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { createProject, createTask, getProject, getTask, updateTask } from "../services/taskService.js";
import { git, readCalls } from "../test-utils/fakeRepo.js";
import { cleanupTeamCases, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";

const extra: string[] = [];

afterAll(() => {
  cleanupTeamCases();
  for (const d of extra) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("executor base-branch precheck (zincir F0.5, plan §5.0)", () => {
  it("defaultBranch missing from the repo → todo + base_branch_missing:<current>, git untouched, CLI never called", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultBranch: "master", defaultTeamId: null } });
    const branchesBefore = git(c.repo, "branch", "--list");
    const task = await runTeamCase(c);

    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(task.agent.error).toBe("base_branch_missing:main");
    expect(task.branch ?? null).toBeNull();
    expect(task.agent.log.some((l) => l.includes('Ana dal "master" repoda yok'))).toBe(true);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "branch", "--list")).toBe(branchesBefore);
    expect(git(c.repo, "rev-parse", "HEAD")).toBe(c.initialHead);
    expect(git(c.repo, "stash", "list")).toBe("");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(readCalls(c.state)).toEqual([]);
    expect(getRepoLockHolder(c.repo)).toBeNull();
  });

  it("repo without commits → base_branch_missing:-", async () => {
    const repo = mkdtempSync(join(tmpdir(), "clauflow-nocommit-"));
    const state = mkdtempSync(join(tmpdir(), "clauflow-nocommit-state-"));
    extra.push(repo, state);
    git(repo, "init", "-q", "-b", "main");
    process.env.FAKE_CLAUDE_STATE = state;
    const project = await createProject({
      name: "No commits",
      repoPath: repo,
      defaultBranch: "main",
      slug: `nc${Date.now().toString(36)}`,
      defaultTeamId: null,
    });
    const created = await createTask({ projectId: project.id, title: "x", description: "y", teamId: null });
    const doing = await updateTask(created.id, { status: "doing" });
    await runExecutor(doing, (await getProject(project.id))!);
    const task = (await getTask(created.id))!;

    expect(task.status).toBe("todo");
    expect(task.agent.error).toBe("base_branch_missing:-");
    expect(git(repo, "for-each-ref", "refs/heads")).toBe("");
    expect(readCalls(state)).toEqual([]);
    expect(getRepoLockHolder(repo)).toBeNull();
  });
});
