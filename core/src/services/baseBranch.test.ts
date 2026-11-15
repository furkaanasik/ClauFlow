import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-basebranch-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditProjectBaseBranches,
  baseBranchExists,
  baseBranchHint,
  currentBranch,
  detectBaseBranch,
  listLocalBranches,
  repoHasCommits,
} from "./baseBranch.js";
import { createProject, getProject } from "./taskService.js";
import { git, makeRepo } from "../test-utils/fakeRepo.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("base branch probes (zincir F0.5, plan §5.0)", () => {
  it("answer from git without writing", async () => {
    const repo = makeRepo("clauflow-bb-");
    dirs.push(repo);
    git(repo, "branch", "side");
    expect(await baseBranchExists(repo, "main")).toBe(true);
    expect(await baseBranchExists(repo, "master")).toBe(false);
    expect(await currentBranch(repo)).toBe("main");
    expect(await listLocalBranches(repo)).toEqual(["main", "side"]);
    expect(await repoHasCommits(repo)).toBe(true);
    expect(await baseBranchHint(repo)).toBe("main");
    expect(await detectBaseBranch(repo)).toBe("main");

    git(repo, "checkout", "-q", "--detach");
    expect(await currentBranch(repo)).toBeNull();
    expect(await baseBranchHint(repo)).toBe("-");

    const unborn = mkdtempSync(join(tmpdir(), "clauflow-bb-unborn-"));
    dirs.push(unborn);
    git(unborn, "init", "-q", "-b", "main");
    expect(await repoHasCommits(unborn)).toBe(false);
    expect(await baseBranchHint(unborn)).toBe("-");
    expect(await listLocalBranches(unborn)).toEqual([]);
  });

  it("the boot audit reports a missing base and changes nothing", async () => {
    const good = makeRepo("clauflow-bb-good-");
    const bad = makeRepo("clauflow-bb-bad-");
    dirs.push(good, bad);
    const pGood = await createProject({ name: "Good", repoPath: good, defaultBranch: "main", slug: "bb-good" });
    const pBad = await createProject({ name: "Bad", repoPath: bad, defaultBranch: "master", slug: "bb-bad" });
    await createProject({ name: "Gone", repoPath: join(tmpdir(), "clauflow-bb-missing-path"), slug: "bb-gone" });
    const headBefore = git(bad, "rev-parse", "HEAD");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const findings = await auditProjectBaseBranches();
      expect(findings).toEqual([
        { projectId: pBad.id, name: "Bad", defaultBranch: "master", head: "main", branches: ["main"] },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('defaultBranch "master" missing; HEAD=main; branches=[main]');
      // idempotent and read-only
      expect(await auditProjectBaseBranches()).toEqual(findings);
    } finally {
      warn.mockRestore();
    }
    expect((await getProject(pBad.id))!.defaultBranch).toBe("master");
    expect((await getProject(pGood.id))!.defaultBranch).toBe("main");
    expect(git(bad, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(bad, "status", "--porcelain")).toBe("");
  });
});
