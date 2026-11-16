import type { Task, TaskStatus } from "@/types";
import type { QuickFilters } from "@/store/viewStore";

/**
 * Pure, UI-side selectors shared by the Board and List views. They only read
 * store data; nothing here mutates tasks or calls the API.
 */

export const COLUMN_STATUSES: TaskStatus[] = ["todo", "doing", "review", "done"];

export function isAgentWorking(task: Task): boolean {
  const s = task.agent?.status;
  return (
    Boolean(s) &&
    s !== "idle" &&
    s !== "done" &&
    s !== "error" &&
    s !== "awaiting_approval" &&
    s !== "waiting_deps"
  );
}

/** zincir: in Doing, waiting for its dependencies (no run, no repo lock). */
export function isWaitingDeps(task: Task): boolean {
  return task.status === "doing" && task.agent?.status === "waiting_deps";
}

/** Team run paused after the Analyst until the user approves the spec. */
export function isAwaitingApproval(task: Task): boolean {
  return task.status === "doing" && task.agent?.status === "awaiting_approval";
}

export function isQueued(task: Task): boolean {
  return task.status === "doing" && task.agent.status === "idle";
}

/* ─── zincir F4.6: conflict resolver (plan §3/33, §5.10) ──────────────────── */

/**
 * The AI conflict resolver works on this Review task's branch (queued for the
 * repo lock or running). `isAgentWorking` covers it too (Z44: the card stays
 * locked, a drag to Done would be refused with `conflict_resolving` anyway).
 */
export function isResolvingConflict(task: Task): boolean {
  return task.status === "review" && task.agent?.status === "resolving_conflict";
}

/** The resolver finished: the branch now contains the base, ready to approve again. */
export function isConflictResolved(task: Task): boolean {
  return task.status === "review" && task.agent?.currentStep === "conflict_resolved";
}

/**
 * The merge conflicted and nothing resolves it now: either the automatic
 * resolver was skipped (`merge_conflict`, a previous run failed) or the run
 * failed (`conflict_unresolved:<reason>`). The drawer offers "Resolve with AI".
 */
export function conflictFailed(task: Task): boolean {
  if (task.status !== "review" || task.agent?.status !== "error") return false;
  const code = task.agent.error ?? "";
  return code === "merge_conflict" || code === "conflict_unresolved" || code.startsWith("conflict_unresolved:");
}

/* ─── zincir: dependency chain (plan §5.6, §3/11) ─────────────────────────── */

type TaskMap = Record<string, Task>;

/** Dependencies of `task` that are not done yet, in `dependsOn` order (unknown ids skipped). */
export function unmetDeps(task: Task, tasks: TaskMap): Task[] {
  const out: Task[] = [];
  for (const id of task.dependsOn ?? []) {
    const dep = tasks[id];
    if (dep && dep.status !== "done") out.push(dep);
  }
  return out;
}

/**
 * A dependency that will not get done on its own: its run failed, got stuck
 * or was aborted (back in To do with an error), or its merge failed in Review
 * (§3/11). A spec gate (`awaiting_approval`) is not a problem.
 */
export function blockerProblem(task: Task): boolean {
  return (task.status === "todo" || task.status === "review") && task.agent?.status === "error";
}

/** Tasks that list `id` in their `dependsOn`. */
export function dependentsOf(id: string, tasks: TaskMap): Task[] {
  return Object.values(tasks).filter((t) => t?.dependsOn?.includes(id));
}

/**
 * Client-side pre-filter (the server decides): would `taskId → candidateId`
 * close a cycle, i.e. does `candidateId` already reach `taskId`?
 */
export function wouldCycle(taskId: string, candidateId: string, tasks: TaskMap): boolean {
  if (taskId === candidateId) return true;
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of tasks[id]?.dependsOn ?? []) stack.push(next);
  }
  return false;
}

/** Waiting tasks whose dependencies are all done but that did not start (E5, §3/25). */
export function readyWaiting(tasks: TaskMap): Task[] {
  return Object.values(tasks).filter((t) => t && isWaitingDeps(t) && unmetDeps(t, tasks).length === 0);
}

/** Waiting tasks that start once `taskId` is done: it is their only unmet dependency (E4). */
export function startsOnMerge(taskId: string, tasks: TaskMap): Task[] {
  return Object.values(tasks).filter((t) => {
    if (!t || !isWaitingDeps(t) || !t.dependsOn?.includes(taskId)) return false;
    return unmetDeps(t, tasks).every((d) => d.id === taskId);
  });
}

export function hasOpenPR(task: Task): boolean {
  return Boolean(task.prNumber) && task.status !== "done";
}

function matchesText(task: Task, needle: string): boolean {
  if (!needle) return true;
  return (
    task.title.toLowerCase().includes(needle) ||
    (task.description ?? "").toLowerCase().includes(needle) ||
    (task.displayId ?? "").toLowerCase().includes(needle)
  );
}

function matchesQuickFilters(task: Task, f: QuickFilters): boolean {
  if (f.priorities.length > 0) {
    const p = task.priority ?? null;
    if (!p || !f.priorities.includes(p)) return false;
  }
  if (f.tags.length > 0) {
    const tags = task.tags ?? [];
    if (!f.tags.some((t) => tags.includes(t))) return false;
  }
  if (f.agentRunning && !isAgentWorking(task)) return false;
  if (f.prOpen && !hasOpenPR(task)) return false;
  return true;
}

/** Tasks of the active project in store order, after search + quick filters. */
export function visibleTasks(
  tasks: Record<string, Task>,
  order: string[],
  filterText: string,
  filters: QuickFilters,
): Task[] {
  const needle = filterText.trim().toLowerCase();
  const out: Task[] = [];
  for (const id of order) {
    const t = tasks[id];
    if (!t) continue;
    if (!matchesText(t, needle)) continue;
    if (!matchesQuickFilters(t, filters)) continue;
    out.push(t);
  }
  return out;
}

/** Lifetime USD spend of a task (CLI `total_cost_usd`), or null when nothing has been spent yet. */
export function taskCost(task: Task): number | null {
  return task.costUsd && task.costUsd > 0 ? task.costUsd : null;
}

export interface SubtaskStats {
  total: number;
  done: number;
}

export function subtaskStats(tasks: Record<string, Task>): Record<string, SubtaskStats> {
  const map: Record<string, SubtaskStats> = {};
  for (const t of Object.values(tasks)) {
    if (!t?.parentTaskId) continue;
    const s = (map[t.parentTaskId] ??= { total: 0, done: 0 });
    s.total += 1;
    if (t.status === "done") s.done += 1;
  }
  return map;
}

/** All tags used on the board with their counts, most used first. */
export function tagCounts(tasks: Task[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of tasks) for (const tag of t.tags ?? []) m.set(tag, (m.get(tag) ?? 0) + 1);
  return [...m.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ─── Manual in-column order (client-side, per project) ─────────────────── */

const ORDER_KEY = (projectId: string) => `board-order:${projectId}`;

export function loadManualOrder(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY(projectId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveManualOrder(projectId: string, ids: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY(projectId), JSON.stringify(ids));
  } catch {}
}

/**
 * Sort one column by the manual rank. Ranked ids come first in rank order;
 * unranked ones keep their store order after them (new tasks land at the end).
 */
export function applyManualOrder(column: Task[], rank: string[]): Task[] {
  if (rank.length === 0) return column;
  const pos = new Map(rank.map((id, i) => [id, i]));
  return column
    .map((t, i) => ({ t, i, r: pos.get(t.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/** Tag dot colour: stable per tag name, picked from the token palette. */
const TAG_DOTS = ["var(--cobalt)", "var(--orange)", "var(--green)", "var(--mustard)", "var(--red)", "var(--ink-3)"];
export function tagDot(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_DOTS[Math.abs(h) % TAG_DOTS.length];
}
