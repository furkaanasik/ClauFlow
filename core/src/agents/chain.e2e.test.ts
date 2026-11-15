import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-chaine2e-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-chaine2e-gh-${stamp}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, getTask } from "../services/taskService.js";
import { installChainHooks, uninstallChainHooks } from "../services/chainService.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { FAKE_CLAUDE, git, makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "../routes/tasks.js";
import { isRunning, waitForIdle } from "./executor.js";

/**
 * zincir F2 (plan §8 F2, D5): the whole chain with the fake CLI, the real
 * executor and a real local merge. B waits for A; approving A (Review → Done)
 * merges it and starts B, which branches from a base that has A's code.
 */

let server: TestServer;
const dirs: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function until(id: string, pred: (t: NonNullable<Awaited<ReturnType<typeof getTask>>>) => boolean, ms = 20_000) {
  await vi.waitFor(
    async () => {
      const t = (await getTask(id))!;
      expect(pred(t)).toBe(true);
    },
    { timeout: ms, interval: 25 },
  );
  return (await getTask(id))!;
}

beforeAll(async () => {
  const state = mkdtempSync(join(tmpdir(), "clauflow-chaine2e-state-"));
  dirs.push(state);
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_STATE = state;
  process.env.FAKE_CLAUDE_SCENARIO = "pass";
  installChainHooks();
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

afterAll(async () => {
  uninstallChainHooks();
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("chain end to end (zincir F2)", () => {
  it("B waits while A runs; A's approval merges A and starts B on top of it", async () => {
    const repo = makeRepo("clauflow-chaine2e-");
    dirs.push(repo);
    const project = await createProject({
      name: "chain e2e",
      repoPath: repo,
      defaultBranch: "main",
      slug: `ce${Date.now().toString(36)}`,
      defaultTeamId: null,
    });
    const a = await createTask({ projectId: project.id, title: "A" });
    const b = await createTask({ projectId: project.id, title: "B", dependsOn: [a.id] });

    // B first, then A: the order of the drags does not matter.
    const pb = await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "en" });
    expect(pb.json.task.agent.status).toBe("waiting_deps");
    const pa = await call("PATCH", `/api/tasks/${a.id}`, { status: "doing", uiLang: "en" });
    expect(pa.json.task.agent.status).toBe("idle");

    const aReview = await until(a.id, (t) => t.status === "review");
    await waitForIdle(a.id, 10_000);
    expect(aReview.branch).toBeTruthy();

    // B still waits: no run, no log, no branch, no lock.
    const bWaiting = (await getTask(b.id))!;
    expect(bWaiting).toMatchObject({ status: "doing", branch: null });
    expect(bWaiting.agent.status).toBe("waiting_deps");
    expect(bWaiting.agent.log).toEqual([]);
    expect(isRunning(b.id)).toBe(false);
    expect(getRepoLockHolder(repo)).toBeNull();

    // Approve A: local merge, then the done trigger starts B.
    const done = await call("PATCH", `/api/tasks/${a.id}`, { status: "done" });
    expect(done.status).toBe(200);
    expect(done.json.task.status).toBe("done");
    const merge = git(repo, "rev-parse", "main");
    expect(git(repo, "log", "-1", "--format=%s", merge)).toContain(`(${a.displayId})`);

    const bReview = await until(b.id, (t) => t.status === "review");
    await waitForIdle(b.id, 10_000);
    expect(bReview.branch).toBeTruthy();
    expect(bReview.branch).not.toBe(aReview.branch);

    // B branched from a base that already contains A's merge…
    git(repo, "merge-base", "--is-ancestor", merge, bReview.branch!);
    // …and its diff against main is only its own change (the fake CLI's Z16 line).
    expect(git(repo, "diff", "--name-only", `main...${bReview.branch}`).split("\n")).toEqual(["fake-1.txt"]);
    expect(git(repo, "show", `${bReview.branch}:fake-1.txt`)).toBe(
      `fake developer output round 1\nfake developer output on ${bReview.branch} round 1`,
    );
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(getRepoLockHolder(repo)).toBeNull();
  }, 60_000);
});
