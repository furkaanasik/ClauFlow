"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { PriorityMark, StatusPill, type PriorityLevel } from "@/components/ui/Pills";
import { IconChevronDown, IconChevronUp, IconPR, IconSort, IconSubtask } from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import {
  COLUMN_STATUSES,
  isAgentWorking,
  tagDot,
  taskCost,
  type SubtaskStats,
} from "@/lib/boardView";
import { formatUsd } from "@/lib/format";
import type { Task } from "@/types";

type SortKey = "key" | "status" | "priority" | "cost" | "updated";
type SortDir = "asc" | "desc";

const PRIO_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function keyNumber(task: Task): number {
  const m = /(\d+)$/.exec(task.displayId ?? "");
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function relTime(iso: string, lang: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = (d - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString(lang);
}

interface TaskListProps {
  /** Filtered tasks, already in board order (column, then manual rank). */
  tasks: Task[];
  subtaskStats: Record<string, SubtaskStats>;
  keyById: Record<string, string>;
}

/** Jira-style table of the current (filtered) tasks. Row click opens detail. */
export function TaskList({ tasks, subtaskStats, keyById }: TaskListProps) {
  const t = useTranslation();
  const lang = useBoardStore((s) => s.lang);
  const selectTask = useBoardStore((s) => s.selectTask);
  const selectPRTask = useBoardStore((s) => s.selectPRTask);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return tasks;
    const val = (x: Task): number => {
      switch (sort.key) {
        case "key":
          return keyNumber(x);
        case "status":
          return COLUMN_STATUSES.indexOf(x.status);
        case "priority":
          return PRIO_RANK[x.priority ?? ""] ?? 0;
        case "cost":
          return taskCost(x) ?? -1;
        case "updated":
          return new Date(x.updatedAt).getTime() || 0;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return tasks
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (val(a.x) - val(b.x)) * dir || a.i - b.i)
      .map((r) => r.x);
  }, [tasks, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: key === "key" || key === "status" ? "asc" : "desc" } : s.dir === "desc" ? { key, dir: "asc" } : s.dir === "asc" && (key === "key" || key === "status") ? { key, dir: "desc" } : null,
    );

  const renderTh = (children: string, k?: SortKey, className?: string) => {
    const activeDir = k && sort?.key === k ? sort.dir : null;
    return (
      <th
        key={children}
        scope="col"
        className={className}
        aria-sort={activeDir === "asc" ? "ascending" : activeDir === "desc" ? "descending" : undefined}
      >
        {k ? (
          <button
            type="button"
            onClick={() => onSort(k)}
            title={t.board.list.sortBy.replace("{col}", children)}
            className="ui-focus t-label inline-flex items-center gap-1.5 rounded-[4px] !text-ink-2 hover:!text-ink"
          >
            {children}
            {activeDir === "asc" ? (
              <IconChevronUp size={12} />
            ) : activeDir === "desc" ? (
              <IconChevronDown size={12} />
            ) : (
              <IconSort size={12} className="opacity-40" />
            )}
          </button>
        ) : (
          <span className="t-label !text-ink-2">{children}</span>
        )}
      </th>
    );
  };

  return (
    <div className="ui-panel ui-panel--raised flex min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 overflow-auto rounded-[12px]">
        <table className="task-table" aria-label={t.board.list.label}>
          <thead>
            <tr>
              {renderTh(t.board.list.key, "key", "w-[92px]")}
              {renderTh(t.board.list.title, undefined)}
              {renderTh(t.board.list.status, "status", "w-[170px]")}
              {renderTh(t.board.list.priority, "priority", "w-[150px]")}
              {renderTh(t.board.list.cost, "cost", "w-[100px]")}
              {renderTh(t.board.list.pr, undefined, "w-[96px]")}
              {renderTh(t.board.list.updated, "updated", "w-[130px]")}
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => {
              const working = isAgentWorking(task);
              const prio = (task.priority ?? "") as PriorityLevel | "";
              const cost = taskCost(task);
              const sub = subtaskStats[task.id];
              const parentKey = task.parentTaskId ? keyById[task.parentTaskId] : undefined;
              return (
                <tr
                  key={task.id}
                  tabIndex={0}
                  data-running={working || undefined}
                  onClick={() => selectTask(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectTask(task.id);
                    }
                  }}
                >
                  <td>
                    <span className="task-card__key">{task.displayId ?? `#${task.id.slice(0, 7)}`}</span>
                  </td>
                  <td>
                    <div className="flex min-w-0 items-center gap-2.5">
                      {parentKey && (
                        <span className="inline-flex flex-none items-center gap-1 font-mono text-[11px] text-ink-3" title={t.taskCard.subtaskOf.replace("{key}", parentKey)}>
                          <IconSubtask size={12} />
                          {parentKey}
                        </span>
                      )}
                      <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{task.title}</span>
                      {sub && sub.total > 0 && (
                        <span className="task-card__meta flex-none">
                          <IconSubtask size={12} />
                          {sub.done}/{sub.total}
                        </span>
                      )}
                      <span className="hidden flex-none items-center gap-1.5 xl:inline-flex">
                        {(task.tags ?? []).slice(0, 2).map((tag) => (
                          <span key={tag} className="inline-flex h-5 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-paper px-2 text-[11px] font-medium text-ink-2">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: tagDot(tag) } as CSSProperties} />
                            {tag}
                          </span>
                        ))}
                      </span>
                    </div>
                  </td>
                  <td>
                    {working ? (
                      <StatusPill status="doing" variant="solid" live>
                        {t.taskCard.agentSteps[task.agent.status]}
                      </StatusPill>
                    ) : (
                      <StatusPill status={task.status}>{t.board.columns[task.status]}</StatusPill>
                    )}
                  </td>
                  <td>
                    {prio ? (
                      <PriorityMark level={prio} label={t.addTask.priorities[prio]} showLabel />
                    ) : (
                      <span className="text-ink-3">{t.board.list.none}</span>
                    )}
                  </td>
                  <td className="font-mono text-[13px] tabular-nums text-ink-2">
                    {cost !== null ? formatUsd(cost) : <span className="text-ink-3">{t.board.list.none}</span>}
                  </td>
                  <td>
                    {task.prNumber ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectPRTask(task.id);
                        }}
                        className="task-card__btn"
                        style={
                          task.status === "done"
                            ? { background: "var(--green)", color: "var(--on-green)" }
                            : { background: "var(--cobalt)", color: "var(--on-cobalt)" }
                        }
                      >
                        <IconPR size={12} />#{task.prNumber}
                      </button>
                    ) : (
                      <span className="text-ink-3">{t.board.list.none}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-[13px] text-ink-3">{relTime(task.updatedAt, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
