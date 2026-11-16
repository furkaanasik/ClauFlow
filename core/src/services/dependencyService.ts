import type { Task } from "../types/index.js";
import { db, getTaskSync } from "./taskService.js";
import { DependencyError, MAX_DEPENDENCIES } from "./dependencyError.js";

export { DependencyError, MAX_DEPENDENCIES } from "./dependencyError.js";
export type { DependencyErrorCode } from "./dependencyError.js";

/**
 * zincir (plan §5.2): task dependency edges. An edge (taskId, dependsOnId)
 * means "taskId waits for dependsOnId". Both tasks live in the same project
 * and the graph has no cycles; SQLite can only enforce the self-edge rule, so
 * the rest is checked here, inside the same synchronous transaction as the
 * write. Project graphs are small (tens of tasks): the edges are loaded into
 * memory and walked with a DFS.
 */

const stmtDependencies = db.prepare(
  `SELECT d.dependsOnId AS id FROM task_dependencies d
     JOIN tasks t ON t.id = d.dependsOnId
    WHERE d.taskId = ?
    ORDER BY t.createdAt ASC, t.rowid ASC`,
);
const stmtDependents = db.prepare(
  `SELECT d.taskId AS id FROM task_dependencies d
     JOIN tasks t ON t.id = d.taskId
    WHERE d.dependsOnId = ?
    ORDER BY t.createdAt ASC, t.rowid ASC`,
);
const stmtProjectEdges = db.prepare(
  `SELECT d.taskId AS taskId, d.dependsOnId AS dependsOnId FROM task_dependencies d
     JOIN tasks t ON t.id = d.taskId
    WHERE t.projectId = ?`,
);
const stmtUnmet = db.prepare(
  `SELECT t.id AS id FROM task_dependencies d
     JOIN tasks t ON t.id = d.dependsOnId
    WHERE d.taskId = ? AND t.status != 'done'
    ORDER BY t.createdAt ASC, t.rowid ASC`,
);
const stmtDeleteEdgesOf = db.prepare(`DELETE FROM task_dependencies WHERE taskId = ?`);
const stmtInsertEdge = db.prepare(
  `INSERT OR IGNORE INTO task_dependencies (taskId, dependsOnId, createdAt) VALUES (?, ?, ?)`,
);
const stmtTaskHead = db.prepare(
  `SELECT id, projectId, status, agentStatus, displayId FROM tasks WHERE id = ?`,
);

interface TaskHead {
  id: string;
  projectId: string;
  status: string;
  agentStatus: string;
  displayId: string | null;
}

function head(id: string): TaskHead | null {
  return (stmtTaskHead.get(id) as TaskHead | undefined) ?? null;
}

export function listDependencies(taskId: string): string[] {
  return (stmtDependencies.all(taskId) as { id: string }[]).map((r) => r.id);
}

export function listDependents(taskId: string): string[] {
  return (stmtDependents.all(taskId) as { id: string }[]).map((r) => r.id);
}

export function listProjectEdges(projectId: string): Array<[string, string]> {
  return (stmtProjectEdges.all(projectId) as { taskId: string; dependsOnId: string }[]).map((r) => [
    r.taskId,
    r.dependsOnId,
  ]);
}

/** Dependencies that are not `done` yet, in board order. */
export function unmetDependencies(taskId: string): Task[] {
  return (stmtUnmet.all(taskId) as { id: string }[])
    .map((r) => getTaskSync(r.id))
    .filter((t): t is Task => t !== null);
}

/** Ids of unmet dependencies (cheap form for the gate and the CAS). */
export function unmetDependencyIds(taskId: string): string[] {
  return (stmtUnmet.all(taskId) as { id: string }[]).map((r) => r.id);
}

/**
 * Would giving `taskId` exactly the dependencies `dependsOnIds` close a cycle?
 * The task's current outgoing edges are ignored (they are being replaced).
 * Returns the cycle as task ids, starting and ending with `taskId`
 * (e.g. [B, A, B] for "B waits for A, A already waits for B"), or null.
 */
export function findCycle(taskId: string, dependsOnIds: string[]): string[] | null {
  const task = head(taskId);
  if (!task) return null;
  const out = new Map<string, string[]>();
  for (const [from, to] of listProjectEdges(task.projectId)) {
    if (from === taskId) continue;
    const list = out.get(from);
    if (list) list.push(to);
    else out.set(from, [to]);
  }

  const visited = new Set<string>();
  // Iterative DFS keeping the path, from each new dependency back to taskId.
  for (const start of dependsOnIds) {
    if (start === taskId) return [taskId, taskId];
    const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    const onPath = [start];
    if (visited.has(start)) continue;
    visited.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = out.get(frame.node) ?? [];
      if (frame.next >= children.length) {
        stack.pop();
        onPath.pop();
        continue;
      }
      const child = children[frame.next]!;
      frame.next += 1;
      if (child === taskId) return [taskId, ...onPath, taskId];
      if (visited.has(child)) continue;
      visited.add(child);
      stack.push({ node: child, next: 0 });
      onPath.push(child);
    }
  }
  return null;
}

/** A task's edges may change only while it is `todo` or waiting (plan §3/8). */
export function dependenciesEditable(task: { status: string; agentStatus?: string; agent?: { status: string } }): boolean {
  const agentStatus = task.agentStatus ?? task.agent?.status;
  return task.status === "todo" || (task.status === "doing" && agentStatus === "waiting_deps");
}

function label(id: string): string {
  return head(id)?.displayId ?? id;
}

/**
 * Replaces the task's whole dependency set (one synchronous transaction):
 * dedupe → validate → delete + insert → the fresh task. Throws DependencyError.
 */
export function setDependencies(taskId: string, dependsOnIds: string[]): Task {
  return db.transaction((): Task => {
    const task = head(taskId);
    if (!task) throw new DependencyError("dependency_not_found", { id: taskId });
    if (!dependenciesEditable(task)) throw new DependencyError("dependencies_locked");

    const ids = [...new Set(dependsOnIds)];
    if (ids.length > MAX_DEPENDENCIES) {
      throw new DependencyError("too_many_dependencies", { max: MAX_DEPENDENCIES });
    }
    if (ids.includes(taskId)) throw new DependencyError("dependency_self");
    for (const id of ids) {
      const dep = head(id);
      if (!dep) throw new DependencyError("dependency_not_found", { id });
      if (dep.projectId !== task.projectId) throw new DependencyError("dependency_cross_project", { id });
    }
    const cycle = findCycle(taskId, ids);
    if (cycle) throw new DependencyError("dependency_cycle", { path: cycle.map(label) });

    const now = new Date().toISOString();
    stmtDeleteEdgesOf.run(taskId);
    for (const id of ids) stmtInsertEdge.run(taskId, id, now);
    return getTaskSync(taskId)!;
  })();
}

/**
 * Adds edges without the lock/state check (planner breakdown, plan §5.5): the
 * caller guarantees the graph stays acyclic and same-project. Existing edges
 * are kept.
 */
export function addEdgesInternal(edges: Array<[string, string]>): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [taskId, dependsOnId] of edges) {
      if (taskId !== dependsOnId) stmtInsertEdge.run(taskId, dependsOnId, now);
    }
  })();
}
