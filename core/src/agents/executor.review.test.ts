import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-exec-review-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-exec-review-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { addBareOrigin, installFakeGh } from "../test-utils/fakeGh.js";
import { git } from "../test-utils/fakeRepo.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";

const origins: string[] = [];

afterAll(() => {
  cleanupTeamCases();
  for (const o of origins) rmSync(o, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("executor end (D1, plan §5.2)", () => {
  it("no remote: pass → review, branch kept with the commit, HEAD back on an untouched base, no PR", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(task.status).toBe("review");
    expect(task.agent.status).toBe("done");
    expect(task.branch).toMatch(/^feature\//);
    expect(task.prUrl ?? null).toBeNull();
    expect(task.prNumber ?? null).toBeNull();
    expect(r.currentBranch).toBe("main");
    expect(git(c.repo, "rev-parse", "main")).toBe(c.initialHead);
    expect(r.status).toBe("");
    expect(r.branches).toEqual([task.branch]);
    expect(r.branchLog(task.branch!)).toHaveLength(1);
    expect(task.agent.log.some((l) => l.includes("No remote"))).toBe(true);
  });

  it("with a remote: push --force-with-lease + gh pr create → review with the PR", async () => {
    const gh = installFakeGh(7);
    try {
      const c = await makeTeamCase({
        scenario: "pass",
        project: { defaultTeamId: null },
        setupRepo: (repo) => origins.push(addBareOrigin(repo)),
      });
      const task = await runTeamCase(c);

      expect(task.status).toBe("review");
      expect(task.prNumber).toBe(7);
      expect(task.prUrl).toBe("https://github.com/acme/fake/pull/7");
      expect(task.branch).toMatch(/^feature\//);
      expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
      expect(git(origins.at(-1)!, "rev-parse", task.branch!)).toBe(git(c.repo, "rev-parse", task.branch!));
      expect(gh.calls().some((l) => l.startsWith("pr create"))).toBe(true);
    } finally {
      gh.restore();
    }
  });
});

describe("executor error codes (zincir E2, plan §3/22)", () => {
  it("the CLI exits non-zero → todo + claude_exit", async () => {
    const c = await makeTeamCase({ scenario: "exit_error", project: { defaultTeamId: null } });
    const task = await runTeamCase(c);
    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(task.agent.error).toBe("claude_exit");
  });

  it("gh pr create fails on a repo with a remote → todo + pr_create_failed", async () => {
    const gh = installFakeGh(9);
    process.env.FAKE_GH_CREATE_FAIL = "simulated: could not create PR";
    try {
      const c = await makeTeamCase({
        scenario: "pass",
        project: { defaultTeamId: null },
        setupRepo: (repo) => origins.push(addBareOrigin(repo)),
      });
      const task = await runTeamCase(c);
      expect(task.status).toBe("todo");
      expect(task.agent.error).toBe("pr_create_failed");
      expect(task.agent.log.some((l) => l.includes("simulated: could not create PR"))).toBe(true);
    } finally {
      delete process.env.FAKE_GH_CREATE_FAIL;
      gh.restore();
    }
  });
});
