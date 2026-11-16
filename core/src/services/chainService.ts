import type { Task } from "../types/index.js";
import type { UiLang } from "../agents/uiText.js";
import { enqueue, isRunning } from "../agents/executor.js";
import { db, getProjectSync, getTaskSync, onTaskBecameDone } from "./taskService.js";
import { listDependents, unmetDependencyIds } from "./dependencyService.js";
import { broadcastChainAdvanced, broadcastTaskUpdated } from "./wsService.js";

/**
 * zincir (plan §5.3): the Doing gate and the chain's state machine.
 *
 *   todo ─PATCH doing─▶ gateDoing ─(unmet)─▶ doing/waiting_deps ─(last dep done)─▶ tryStartWaiting ─▶ doing/idle ─▶ executor
 *                            └─(all done)─▶ doing/idle ─▶ executor
 *
 * A waiting task is not in the executor's maps: it holds no repo lock and no
 * process. Starting it is a compare-and-set on the row (better-sqlite3 is
 * synchronous and Node single-threaded), so two triggers can never claim the
 * same task twice. Boot never starts a waiting task (plan §3/25).
 */

const UNMET_EXISTS = `EXISTS (
  SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id = d.dependsOnId
   WHERE d.taskId = tasks.id AND dep.status != 'done'
)`;

const stmtWait = db.prepare(
  `UPDATE tasks SET status = 'doing', agentStatus = 'waiting_deps', agentCurrentStep = 'waiting_deps',
     agentLog = '[]', agentError = NULL, agentStartedAt = NULL, agentFinishedAt = NULL,
     waitUiLang = @uiLang, updatedAt = @now
   WHERE id = @id`,
);
const stmtReset = db.prepare(
  `UPDATE tasks SET status = 'doing', agentStatus = 'idle', agentCurrentStep = NULL,
     agentLog = '[]', agentError = NULL, agentStartedAt = NULL, agentFinishedAt = NULL,
     waitUiLang = NULL, updatedAt = @now
   WHERE id = @id`,
);
const stmtClaim = db.prepare(
  `UPDATE tasks SET agentStatus = 'idle', agentCurrentStep = NULL, agentLog = '[]', agentError = NULL,
     agentStartedAt = NULL, agentFinishedAt = NULL, waitUiLang = NULL, updatedAt = @now
   WHERE id = @id AND status = 'doing' AND agentStatus = 'waiting_deps' AND NOT ${UNMET_EXISTS}`,
);
const stmtAbortWaiting = db.prepare(
  `UPDATE tasks SET status = 'todo', agentStatus = 'error', agentCurrentStep = NULL,
     agentError = 'aborted_while_waiting', agentFinishedAt = @now, waitUiLang = NULL, updatedAt = @now
   WHERE id = @id AND status = 'doing' AND agentStatus = 'waiting_deps'`,
);
const stmtWaitUiLang = db.prepare(`SELECT waitUiLang FROM tasks WHERE id = ?`);
const stmtWaitingIds = db.prepare(
  `SELECT id FROM tasks WHERE status = 'doing' AND agentStatus = 'waiting_deps' ORDER BY createdAt ASC, rowid ASC`,
);

function asUiLang(raw: unknown): UiLang | undefined {
  return raw === "tr" || raw === "en" ? raw : undefined;
}

export interface GateResult {
  kind: "start" | "wait";
  task: Task;
  /** Ids of the dependencies that are not done yet (empty on "start"). */
  unmet: string[];
}

/**
 * Every entry into Doing passes here (PATCH doing, /retry; plan §3/5). One
 * synchronous transaction: with an unmet dependency the task waits
 * (`waiting_deps`, the UI language is kept for the later automatic start),
 * otherwise the agent state is reset as before and the caller enqueues.
 */
export function gateDoing(taskId: string, uiLang?: UiLang): GateResult {
  return db.transaction((): GateResult => {
    const unmet = unmetDependencyIds(taskId);
    const now = new Date().toISOString();
    if (unmet.length > 0) {
      stmtWait.run({ id: taskId, uiLang: uiLang ?? null, now });
      return { kind: "wait", task: getTaskSync(taskId)!, unmet };
    }
    stmtReset.run({ id: taskId, now });
    return { kind: "start", task: getTaskSync(taskId)!, unmet: [] };
  })();
}

/**
 * Claims a waiting task whose dependencies are all done and starts it
 * (plan §3/4). Returns the started task, or null when the task is not waiting,
 * still has an unmet dependency, or another trigger claimed it first.
 */
export function tryStartWaiting(taskId: string): Task | null {
  const claimed = db.transaction((): { uiLang: UiLang | undefined } | null => {
    const row = stmtWaitUiLang.get(taskId) as { waitUiLang: string | null } | undefined;
    if (!row) return null;
    const changes = stmtClaim.run({ id: taskId, now: new Date().toISOString() }).changes;
    return changes === 1 ? { uiLang: asUiLang(row.waitUiLang) } : null;
  })();
  if (!claimed) return null;

  // Fresh row (plan Z15): the team or title may have changed while it waited.
  const task = getTaskSync(taskId)!;
  broadcastTaskUpdated(task);
  const project = getProjectSync(task.projectId);
  if (!project) {
    console.warn(`[chain] ${task.displayId ?? task.id}: project ${task.projectId} not found; not started`);
    return task;
  }
  if (!isRunning(taskId)) enqueue(task, project, { uiLang: claimed.uiLang });
  return task;
}

/**
 * Rolls a waiting task back to todo without touching git (plan §3/10).
 * Returns null when the task is no longer waiting (it may have just started).
 */
export function abortWaiting(taskId: string): Task | null {
  const changes = stmtAbortWaiting.run({ id: taskId, now: new Date().toISOString() }).changes;
  if (changes !== 1) return null;
  return getTaskSync(taskId);
}

/** True when the task waits and none of its dependencies is unmet (crash window). */
export function isReadyWaiting(task: Task): boolean {
  return task.status === "doing" && task.agent.status === "waiting_deps" && unmetDependencyIds(task.id).length === 0;
}

/**
 * `doneTask` just became done: start every waiting dependent whose
 * dependencies are now all done, and announce them in one `chain_advanced`
 * event. Returns the started ids (for tests).
 */
export function startReadyDependents(doneTask: Task, prev: Task): string[] {
  const started: Task[] = [];
  for (const id of listDependents(doneTask.id)) {
    const task = tryStartWaiting(id);
    if (task) started.push(task);
  }
  if (started.length > 0) {
    broadcastChainAdvanced(doneTask.id, {
      projectId: doneTask.projectId,
      displayId: doneTask.displayId ?? null,
      merged: prev.status === "review",
      started: started.map((t) => ({ id: t.id, displayId: t.displayId ?? null })),
    });
    console.log(
      `[chain] ${doneTask.displayId ?? doneTask.id} done → started ${started.map((t) => t.displayId ?? t.id).join(", ")}`,
    );
  }
  return started.map((t) => t.id);
}

let uninstall: (() => void) | null = null;

/** Installs the "→ done" listener once (boot, tests). A second call is a no-op. */
export function installChainHooks(): void {
  if (uninstall) return;
  uninstall = onTaskBecameDone((next, prev) => {
    startReadyDependents(next, prev);
  });
}

/** Test helper: removes the listener so another test file's setup starts clean. */
export function uninstallChainHooks(): void {
  uninstall?.();
  uninstall = null;
}

export interface WaitingSweep {
  waiting: string[];
  /** Waiting tasks whose dependencies are all done (left over from a crash window). */
  ready: string[];
}

/**
 * Boot report (plan §3/25, E5): lists waiting tasks and the ones that are
 * ready but were never started. Starts nothing and writes nothing; the user
 * starts them from the board ("Start").
 */
export function sweepWaitingTasks(): WaitingSweep {
  const waiting = (stmtWaitingIds.all() as { id: string }[]).map((r) => r.id);
  const ready = waiting.filter((id) => unmetDependencyIds(id).length === 0);
  if (ready.length > 0) {
    const labels = ready.map((id) => getTaskSync(id)?.displayId ?? id);
    console.warn(
      `[core] ${ready.length} waiting task(s) have all dependencies met; not auto-started: ${labels.join(", ")}`,
    );
  }
  return { waiting, ready };
}
