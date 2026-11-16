/**
 * Conflict resolver (zincir F4.6, plan §1 "Ek 4", §3/32–46, §5.10).
 *
 * A merge that ends in `merge_conflict` starts one automatic resolver run per
 * merge attempt: the task stays in `review` with `agent.status:
 * "resolving_conflict"`, the base is merged INTO the task branch, an AI role
 * resolves the markers, one QA round checks it, and the task is left in Review
 * for the user to approve again. The resolver never merges into the base and
 * never writes `done` (C3, §3/44).
 *
 * This file holds the run registry (RESOLVING, the executor's PENDING/RUNNING
 * pattern, §3/42), the guards' predicate, abort, and the trigger
 * (`onMergeConflict`, §3/32). `startResolution`'s body is the resolver service
 * (F4.6 item "Çözücü servisi").
 */
import { randomUUID } from "node:crypto";
import { appendAgentLog, updateTask } from "../services/taskService.js";
import { broadcastLog, broadcastTaskUpdated } from "../services/wsService.js";
import type { UiLang } from "./uiText.js";
import type { Project, Task } from "../types/index.js";

export type ResolverPhase = "queued" | "running";

interface ResolveHandle {
  token: string;
  controller: AbortController;
  /** "queued" while waiting for the repo lock, "running" once it holds it. */
  phase: ResolverPhase;
}

const RESOLVING = new Map<string, ResolveHandle>();

export interface ResolutionOptions {
  /** "conflict": after a failed merge or the drawer's "Resolve with AI"; "update": "Update branch" (§3/46). */
  mode: "conflict" | "update";
  /** "auto": started by `onMergeConflict`; "manual": `POST /resolve`. */
  trigger: "auto" | "manual";
  uiLang?: UiLang;
}

/** True while a resolver run for `taskId` is queued or running in this process. */
export function isResolving(taskId: string): boolean {
  return RESOLVING.has(taskId);
}

export function resolverPhase(taskId: string): ResolverPhase | null {
  return RESOLVING.get(taskId)?.phase ?? null;
}

/**
 * Guard predicate (§3/42): a live run in the registry, or the persisted
 * `review` + `resolving_conflict` state (the gap before the run registers, or
 * a run lost to a restart until boot recovery marks it failed).
 */
export function isConflictResolving(task: Task): boolean {
  return (
    isResolving(task.id) ||
    (task.status === "review" && task.agent.status === "resolving_conflict")
  );
}

/**
 * Aborts the task's resolver run. Queued: the lock wait drops out and git is
 * never touched; running: the run restores the branch (§3/40). Either way the
 * run itself writes `conflict_unresolved:aborted`. False when there is no run.
 */
export function abortResolution(taskId: string): boolean {
  const handle = RESOLVING.get(taskId);
  if (!handle) return false;
  handle.controller.abort();
  return true;
}

/** Registers a queued run for `taskId` (or returns the one already there). */
function claimHandle(taskId: string): ResolveHandle {
  const existing = RESOLVING.get(taskId);
  if (existing) return existing;
  const handle: ResolveHandle = { token: randomUUID(), controller: new AbortController(), phase: "queued" };
  RESOLVING.set(taskId, handle);
  return handle;
}

/** Drops the registry entry only when it still belongs to `token`. */
function releaseHandle(taskId: string, token: string): void {
  if (RESOLVING.get(taskId)?.token === token) RESOLVING.delete(taskId);
}

/**
 * Test helper: registers a fake run for `taskId` (phase `phase`) without
 * starting anything, or takes over the entry already there. Returns its abort
 * signal and the cleanup that removes it.
 */
export function __setResolvingForTest(
  taskId: string,
  phase: ResolverPhase = "queued",
): { signal: AbortSignal; release: () => void } {
  const handle = claimHandle(taskId);
  handle.phase = phase;
  return { signal: handle.controller.signal, release: () => releaseHandle(taskId, handle.token) };
}

/**
 * Runs the resolver for a task in `review` (§5.10 flow). Reuses the queued
 * handle `onMergeConflict` registered, or registers one.
 *
 * Skeleton (F4.6 item "Durum, kodlar ve korumalar"): the body (lock, backup
 * ref, merge, resolver role, verification, QA, push, restore) is the next
 * item. Nothing calls this yet: `onMergeConflict` is wired into the merge
 * routes only in the item "Tetik ve uçlar".
 */
export async function startResolution(taskId: string, opts: ResolutionOptions): Promise<void> {
  const handle = claimHandle(taskId);
  try {
    void opts;
    throw new Error("conflict resolver not implemented yet");
  } catch (err) {
    console.warn(`[resolver] task ${taskId}:`, err instanceof Error ? err.message : err);
    const failed = await updateTask(taskId, {
      agent: {
        status: "error",
        currentStep: undefined,
        error: "conflict_unresolved:git",
        finishedAt: new Date().toISOString(),
      },
    }).catch(() => null);
    if (failed) broadcastTaskUpdated(failed);
  } finally {
    releaseHandle(taskId, handle.token);
  }
}

/**
 * Indirection for the deferred start, so tests can spy on (and stub) it:
 * an ESM module's internal call cannot be intercepted otherwise.
 */
export const resolverRuntime = {
  startResolution: (taskId: string, opts: ResolutionOptions): Promise<void> => startResolution(taskId, opts),
};

async function logLine(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}

/**
 * The trigger (§3/32, C1, C4): called by a merge attempt (PATCH review→done,
 * the PR drawer's merge) that ended in `merge_conflict`, before it answers 409.
 *
 * - The task's current `agent.error` is `conflict_unresolved:*`: the previous
 *   automatic attempt failed and the user did nothing else since. No new run;
 *   `agent.error = "merge_conflict"` as before F4.6, `{ resolving: false }`
 *   (a new attempt only from the drawer's "Resolve with AI").
 * - Otherwise: `review` / `resolving_conflict` / `queued`, a queued registry
 *   entry, and `startResolution` deferred with `setImmediate`, so the caller's
 *   409 goes out first. `{ resolving: true }`.
 *
 * Only one automatic attempt per merge attempt, and no loop: the resolver
 * never merges, so a new merge attempt only comes from the user.
 */
export async function onMergeConflict(
  task: Task,
  project: Project,
  files: string[],
  uiLang?: UiLang,
): Promise<{ resolving: boolean }> {
  void project;
  // A run is already on it (the merge routes' guards make this unreachable).
  if (isResolving(task.id)) return { resolving: true };
  const now = new Date().toISOString();
  if (task.agent.error?.startsWith("conflict_unresolved")) {
    const errTask = await updateTask(task.id, {
      agent: { status: "error", currentStep: undefined, error: "merge_conflict", finishedAt: now },
    });
    broadcastTaskUpdated(errTask);
    return { resolving: false };
  }

  claimHandle(task.id);
  const queued = await updateTask(task.id, {
    agent: {
      status: "resolving_conflict",
      currentStep: "queued",
      error: null,
      startedAt: now,
      finishedAt: null,
    },
  });
  broadcastTaskUpdated(queued);
  await logLine(
    task.id,
    `▸ Merge conflict${files.length ? ` (${files.join(", ")})` : ""}; AI conflict resolver queued`,
  );
  setImmediate(() => {
    resolverRuntime
      .startResolution(task.id, { mode: "conflict", trigger: "auto", uiLang })
      .catch((err) => console.error("[resolver]", err));
  });
  return { resolving: true };
}
