import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-commentlock-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-commentlock-gh-${stamp}`;
});

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runComment } from "./commentRunner.js";
import { createComment, getComment } from "../services/commentService.js";
import { acquireRepoLock } from "../services/repoLock.js";
import { updateTask } from "../services/taskService.js";
import { git } from "../test-utils/fakeRepo.js";
import { startTestServer } from "../test-utils/httpApp.js";
import { cleanupTeamCases, makeTeamCase, type TeamCase } from "../test-utils/teamHarness.js";
import tasksRouter from "../routes/tasks.js";
import commentsRouter from "../routes/comments.js";

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A task in review with a one-commit feature branch; repo back on main. */
async function reviewCase(scenario = "pass"): Promise<TeamCase & { branch: string }> {
  const c = await makeTeamCase({ scenario, project: { defaultTeamId: null } });
  const branch = "feature/clf-1-review";
  git(c.repo, "checkout", "-q", "-b", branch);
  writeFileSync(join(c.repo, "work.txt"), "work\n");
  git(c.repo, "add", "-A");
  git(c.repo, "commit", "-q", "-m", "feat: work");
  git(c.repo, "checkout", "-q", "main");
  await updateTask(c.task.id, { status: "review", branch });
  return { ...c, branch };
}

describe("comment runner and the repo lock (A1f)", () => {
  it("waits for the repo lock, commits on the branch and returns to base", async () => {
    const c = await reviewCase();
    const holder = await acquireRepoLock(c.repo, { owner: "task:other:tok" });
    const comment = createComment(c.task.id, "please tweak");
    const running = runComment(comment, c.project);
    await sleep(150);
    expect(getComment(comment.id)!.status).toBe("pending");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    holder.release();
    await running;

    expect(getComment(comment.id)!.status).toBe("done");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "log", "--format=%s", `main..${c.branch}`).split("\n")[0]).toMatch(/user feedback applied/);
  });

  it("a failed run stashes the leftover edits as clauflow-comment-<id> and returns to base", async () => {
    const c = await reviewCase("exit_error");
    const comment = createComment(c.task.id, "break it");
    await runComment(comment, c.project);
    expect(getComment(comment.id)!.status).toBe("error");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "stash", "list")).toContain(`clauflow-comment-${comment.id}`);
  });

  it("ends with task_running when the task is doing by the time it gets the lock", async () => {
    const c = await reviewCase();
    await updateTask(c.task.id, { status: "doing" });
    const comment = createComment(c.task.id, "too late");
    await runComment(comment, c.project);
    const done = getComment(comment.id)!;
    expect(done.status).toBe("error");
    expect(done.agentLog.join("\n")).toContain("task_running");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("route: doing → 409 task_running, done without branch → 409 no_branch, review → 201", async () => {
    const c = await reviewCase();
    const server = await startTestServer([
      ["/api/tasks/:id/comments", commentsRouter],
      ["/api/tasks", tasksRouter],
    ]);
    const post = (body: string) =>
      fetch(`${server.url}/api/tasks/${c.task.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
    try {
      await updateTask(c.task.id, { status: "doing" });
      const r1 = await post("x");
      expect(r1.status).toBe(409);
      expect(await r1.json()).toEqual({ error: "task_running" });

      await updateTask(c.task.id, { status: "done", branch: "feature/gone" });
      const r2 = await post("x");
      expect(r2.status).toBe(409);
      expect(await r2.json()).toEqual({ error: "no_branch" });

      await updateTask(c.task.id, { status: "done", branch: c.branch });
      const r3 = await post("old local task");
      expect(r3.status).toBe(201);
      const { comment } = (await r3.json()) as { comment: { id: string } };
      for (let i = 0; i < 100 && getComment(comment.id)!.status !== "done"; i++) await sleep(50);

      await updateTask(c.task.id, { status: "review" });
      const r4 = await post("review is fine");
      expect(r4.status).toBe(201);
      const { comment: c4 } = (await r4.json()) as { comment: { id: string } };
      for (let i = 0; i < 100 && getComment(c4.id)!.status !== "done"; i++) await sleep(50);
      expect(getComment(c4.id)!.status).toBe("done");
      expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    } finally {
      await server.close();
    }
  });
});
