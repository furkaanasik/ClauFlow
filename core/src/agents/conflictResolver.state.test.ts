import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-resolver-state-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, getTask, updateTask } from "../services/taskService.js";
import {
  __setResolvingForTest,
  abortResolution,
  isConflictResolving,
  isResolving,
  onMergeConflict,
  resolverPhase,
  resolverRuntime,
} from "./conflictResolver.js";
import type { Project, Task } from "../types/index.js";

let tmp = "";
let project: Project;

const flush = () => new Promise<void>((r) => setImmediate(r));

async function reviewTask(error: string | null = null): Promise<Task> {
  const t = await createTask({ projectId: project.id, title: "conflicting work" });
  return updateTask(t.id, {
    status: "review",
    branch: "feature/clf-9-x",
    agent: { status: error ? "error" : "done", currentStep: undefined, error },
  });
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "clauflow-resolver-state-"));
  project = await createProject({ name: "Resolver", repoPath: join(tmp, "repo"), slug: "resolver" });
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("onMergeConflict (zincir F4.6, §3/32–33)", () => {
  it("first conflict → resolving: true, review/resolving_conflict/queued, start deferred past the answer", async () => {
    const start = vi.spyOn(resolverRuntime, "startResolution").mockResolvedValue();
    const task = await reviewTask();

    const r = await onMergeConflict(task, project, ["shared.txt"], "tr");
    expect(r).toEqual({ resolving: true });
    // The caller answers 409 before the run starts (setImmediate).
    expect(start).not.toHaveBeenCalled();

    const row = (await getTask(task.id))!;
    expect(row.status).toBe("review");
    expect(row.agent).toMatchObject({ status: "resolving_conflict", currentStep: "queued", error: null });
    expect(row.agent.log.some((l) => l.includes("shared.txt") && l.includes("resolver queued"))).toBe(true);
    expect(isResolving(task.id)).toBe(true);
    expect(resolverPhase(task.id)).toBe("queued");
    expect(isConflictResolving(row)).toBe(true);

    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(task.id, { mode: "conflict", trigger: "auto", uiLang: "tr" });

    __setResolvingForTest(task.id).release();
    expect(isResolving(task.id)).toBe(false);
  });

  it("previous attempt failed (conflict_unresolved:qa_fail) → resolving: false, error/merge_conflict, no run", async () => {
    const start = vi.spyOn(resolverRuntime, "startResolution").mockResolvedValue();
    const task = await reviewTask("conflict_unresolved:qa_fail");

    expect(await onMergeConflict(task, project, ["shared.txt"])).toEqual({ resolving: false });
    await flush();
    expect(start).not.toHaveBeenCalled();

    const row = (await getTask(task.id))!;
    expect(row.status).toBe("review");
    expect(row.agent).toMatchObject({ status: "error", error: "merge_conflict" });
    expect(isResolving(task.id)).toBe(false);
    expect(isConflictResolving(row)).toBe(false);
  });

  it("an earlier plain merge_conflict (before F4.6, or a cleared failure) still gets one automatic attempt", async () => {
    const start = vi.spyOn(resolverRuntime, "startResolution").mockResolvedValue();
    const task = await reviewTask("merge_conflict");
    expect(await onMergeConflict(task, project, [])).toEqual({ resolving: true });
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    __setResolvingForTest(task.id).release();
  });

  it("a run already registered → no second run, state untouched", async () => {
    const start = vi.spyOn(resolverRuntime, "startResolution").mockResolvedValue();
    const task = await reviewTask();
    const fake = __setResolvingForTest(task.id, "running");
    try {
      expect(await onMergeConflict(task, project, ["a.txt"])).toEqual({ resolving: true });
      await flush();
      expect(start).not.toHaveBeenCalled();
      expect((await getTask(task.id))!.agent.status).toBe("done");
    } finally {
      fake.release();
    }
  });
});

describe("registry and abort (§3/42)", () => {
  it("abortResolution: false without a run; aborts the run's signal and keeps the entry for the run to unwind", async () => {
    const task = await reviewTask();
    expect(abortResolution(task.id)).toBe(false);
    expect(resolverPhase(task.id)).toBeNull();

    const fake = __setResolvingForTest(task.id, "running");
    expect(resolverPhase(task.id)).toBe("running");
    expect(abortResolution(task.id)).toBe(true);
    expect(fake.signal.aborted).toBe(true);
    expect(isResolving(task.id)).toBe(true);
    fake.release();
    expect(isResolving(task.id)).toBe(false);
  });

  it("isConflictResolving also reads the persisted state (review + resolving_conflict)", async () => {
    const task = await reviewTask();
    expect(isConflictResolving(task)).toBe(false);
    const persisted = await updateTask(task.id, { agent: { status: "resolving_conflict", currentStep: "merging" } });
    expect(isResolving(task.id)).toBe(false);
    expect(isConflictResolving(persisted)).toBe(true);
    // Not in review (should never happen): not a resolver state.
    expect(isConflictResolving({ ...persisted, status: "todo" })).toBe(false);
  });
});
