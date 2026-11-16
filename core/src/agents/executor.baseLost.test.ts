import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-baselost-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-baselost-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { createTask, getProject, getTask, updateTask } from "../services/taskService.js";
import { gateDoing, installChainHooks, uninstallChainHooks } from "../services/chainService.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { BUILTIN_TEAM_IDS } from "../services/teamTemplates.js";
import { git } from "../test-utils/fakeRepo.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";

/**
 * bakim #1 (plan §3/1–4, §5.1): the base branch is renamed or deleted while the
 * team runs (fake CLI FAKE_CLAUDE_RENAME_BASE, after the developer wrote its
 * file). The task must not close as "no changes / done": it goes back to todo
 * with base_branch_missing:<task branch>, the branch and its commit stay, the
 * repo is left on the task branch and no chain trigger fires.
 */

beforeAll(() => installChainHooks());
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  uninstallChainHooks();
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

const branchExists = (repo: string, b: string) => {
  try {
    git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`);
    return true;
  } catch {
    return false;
  }
};

describe("base branch lost mid-run (bakim #1)", () => {
  it("Yazılım Ekibi + main:trunk → todo + base_branch_missing:<branch>, work kept on the branch", async () => {
    const c = await makeTeamCase({ scenario: "pass", teamId: BUILTIN_TEAM_IDS.yazilimEkibi, project: { defaultTeamId: null } });
    vi.stubEnv("FAKE_CLAUDE_RENAME_BASE", "main:trunk");
    const task = await runTeamCase(c);
    const r = inspect(c);
    const branch = task.branch!;

    expect(task.status).toBe("todo");
    expect(task.status).not.toBe("done");
    expect(task.agent.status).toBe("error");
    expect(branch).toMatch(/^feature\//);
    expect(task.agent.error).toBe(`base_branch_missing:${branch}`);
    expect(r.currentBranch).toBe(branch);
    expect(r.status).toBe("");
    expect(branchExists(c.repo, branch)).toBe(true);
    expect(branchExists(c.repo, "main")).toBe(false);
    expect(git(c.repo, "diff", "--name-only", `trunk...${branch}`).split("\n")).toContain("fake-1.txt");
    expect(git(c.repo, "log", "--format=%s", `trunk..${branch}`)).not.toBe("");
    expect(r.comments.some((x) => x.body.startsWith("No changes needed"))).toBe(false);
    expect(r.comments.some((x) => x.body.includes("The base branch `main` was deleted or renamed"))).toBe(true);
    expect(r.comments.some((x) => x.body.includes(branch))).toBe(true);
    expect(getRepoLockHolder(c.repo)).toBeNull();
  });

  it("Solo + main: (deleted) → same path, Turkish note with uiLang tr", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    vi.stubEnv("FAKE_CLAUDE_RENAME_BASE", "main:");
    const task = await runTeamCase(c, { uiLang: "tr" });
    const r = inspect(c);
    const branch = task.branch!;

    expect(r.roles).toEqual(["developer:1"]);
    expect(task.status).toBe("todo");
    expect(task.agent.error).toBe(`base_branch_missing:${branch}`);
    expect(r.currentBranch).toBe(branch);
    expect(git(c.repo, "branch", "--format=%(refname:short)")).toBe(branch);
    expect(git(c.repo, "show", "--name-only", "--format=", branch).split("\n")).toContain("fake-1.txt");
    expect(r.comments.some((x) => x.body.startsWith("Değişiklik gerekmedi"))).toBe(false);
    expect(r.comments.some((x) => x.body.startsWith("Ana dal `main` koşu sırasında silindi"))).toBe(true);
    expect(getRepoLockHolder(c.repo)).toBeNull();
  });

  it("a waiting dependent keeps waiting (no fake done, B4)", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const dep = await createTask({ projectId: c.project.id, title: "Uses slugify", dependsOn: [c.task.id] });
    await updateTask(dep.id, { status: "doing" });
    expect(gateDoing(dep.id, "en").kind).toBe("wait");
    vi.stubEnv("FAKE_CLAUDE_RENAME_BASE", "main:trunk");
    const task = await runTeamCase(c);
    expect(task.status).toBe("todo");
    await new Promise((r) => setTimeout(r, 200));
    const after = (await getTask(dep.id))!;
    expect(after.status).toBe("doing");
    expect(after.agent.status).toBe("waiting_deps");
  });

  it("after the base is restored, a new run starts clean and keeps the old branch as -wip-1", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    vi.stubEnv("FAKE_CLAUDE_RENAME_BASE", "main:trunk");
    const first = await runTeamCase(c);
    const branch = first.branch!;
    expect(first.agent.error).toBe(`base_branch_missing:${branch}`);
    const oldTip = git(c.repo, "rev-parse", branch);

    git(c.repo, "branch", "-m", "trunk", "main");
    vi.unstubAllEnvs();
    const project = (await getProject(c.project.id))!;
    expect(project.defaultBranch).toBe("main");
    const second = await runTeamCase(c);
    const r = inspect(c);

    expect(second.status).toBe("review");
    expect(second.agent.error).toBeNull();
    expect(second.branch).toBe(branch);
    expect(r.currentBranch).toBe("main");
    expect(r.branches.sort()).toEqual([branch, `${branch}-wip-1`].sort());
    expect(git(c.repo, "rev-parse", `${branch}-wip-1`)).toBe(oldTip);
    expect(getRepoLockHolder(c.repo)).toBeNull();
  });
});
