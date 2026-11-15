import type { Task, TaskStatus } from "@/types";
import type { QuickFilters } from "@/store/viewStore";

/**
 * Pure, UI-side selectors shared by the Board and List views. They only read
 * store data; nothing here mutates tasks or calls the API.
 */

export const COLUMN_STATUSES: TaskStatus[] = ["todo", "doing", "review", "done"];

export function isAgentWorking(task: Task): boolean {
  const s = task.agent?.status;
  return Boolean(s) && s !== "idle" && s !== "done" && s !== "error" && s !== "awaiting_approval";
}

/** Team run paused after the Analyst until the user approves the spec. */
export function isAwaitingApproval(task: Task): boolean {
  return task.status === "doing" && task.agent?.status === "awaiting_approval";
}

export function isQueued(task: Task): boolean {
  return task.status === "doing" && task.agent.status === "idle";
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
