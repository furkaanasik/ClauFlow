import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-exec-nogh-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-exec-nogh-gh-${stamp}`;
});

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runComment } from "./commentRunner.js";
import { createComment, getComment } from "../services/commentService.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { updateTask } from "../services/taskService.js";
import { addBareOrigin } from "../test-utils/fakeGh.js";
import { git, readCalls } from "../test-utils/fakeRepo.js";
import { withoutGh } from "../test-utils/noGh.js";
import { cleanupTeamCases, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";

const origins: string[] = [];

afterAll(() => {
  cleanupTeamCases();
  for (const o of origins) rmSync(o, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("gh precheck (zincir E1, plan §3/21)", () => {
  it("no remote, no gh on PATH → the run never spawns gh and reaches review", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const restore = withoutGh();
    try {
      const task = await runTeamCase(c);
      expect(task.status).toBe("review");
      expect(task.agent.error ?? null).toBeNull();
      expect(task.branch).toMatch(/^feature\//);
      expect(git(c.repo, "branch", "--list", task.branch!)).not.toBe("");
    } finally {
      restore();
    }
  });

  it("remote, no gh on PATH → todo + gh_missing before any git write, CLI never called", async () => {
    const c = await makeTeamCase({
      scenario: "pass",
      project: { defaultTeamId: null },
      setupRepo: (repo) => origins.push(addBareOrigin(repo)),
    });
    const branchesBefore = git(c.repo, "branch", "--list");
    const stashBefore = git(c.repo, "stash", "list");
    const restore = withoutGh();
    let task;
    try {
      task = await runTeamCase(c);
    } finally {
      restore();
    }
    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(task.agent.error).toBe("gh_missing");
    expect(task.agent.log.some((l) => l.includes("gh bulunamadı"))).toBe(true);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "branch", "--list")).toBe(branchesBefore);
    expect(git(c.repo, "stash", "list")).toBe(stashBefore);
    expect(readCalls(c.state)).toEqual([]);
    expect(getRepoLockHolder(c.repo)).toBeNull();
  });

  it("comment on a remote-less repo without gh → done", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const branch = "feature/clf-1-nogh";
    git(c.repo, "checkout", "-q", "-b", branch);
    writeFileSync(join(c.repo, "work.txt"), "work\n");
    git(c.repo, "add", "-A");
    git(c.repo, "commit", "-q", "-m", "feat: work");
    git(c.repo, "checkout", "-q", "main");
    await updateTask(c.task.id, { status: "review", branch });
    const comment = createComment(c.task.id, "tweak");
    const restore = withoutGh();
    try {
      await runComment(comment, c.project);
    } finally {
      restore();
    }
    const after = getComment(comment.id)!;
    expect(after.status).toBe("done");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });
});
