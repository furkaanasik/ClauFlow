"use client";

import clsx from "clsx";
import type { CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "@/components/Card/TaskCard";
import { Button, IconButton } from "@/components/ui/Button";
import { STATUS_COLOR } from "@/components/ui/Pills";
import { IconChevronLeft, IconChevronRight, IconPlus, IconSpinner } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { isAgentWorking, type SubtaskStats } from "@/lib/boardView";
import type { Task, TaskStatus } from "@/types";

interface BoardColumnProps {
  status: TaskStatus;
  title: string;
  numeral?: string;
  tasks: Task[];
  onAddTask?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** While a card is being dragged: can it land here without a confirm? */
  dropTarget?: "allowed" | "confirm" | null;
  subtaskStats?: Record<string, SubtaskStats>;
  keyById?: Record<string, string>;
  /** First load: show card skeletons instead of the empty state. */
  loading?: boolean;
  /** The AI planner is still writing this project's tasks (Todo lane only). */
  planning?: boolean;
}

export function BoardColumn({
  status,
  title,
  tasks,
  onAddTask,
  collapsed,
  onToggleCollapse,
  dropTarget = null,
  subtaskStats = {},
  keyById = {},
  loading = false,
  planning = false,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });
  const t = useTranslation();
  const emptyState = planning ? t.board.planner.todoEmpty : t.board.emptyStates[status];
  const tone = STATUS_COLOR[status];
  const laneStyle = { "--lane": tone.fill } as CSSProperties;

  const hasActiveAgent = status === "doing" && tasks.some(isAgentWorking);
  const overState = isOver && dropTarget ? dropTarget : undefined;

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        onClick={onToggleCollapse}
        data-over={overState}
        data-target={dropTarget ?? undefined}
        aria-label={`${title} · ${tasks.length}`}
        className="lane lane--strip"
        style={laneStyle}
      >
        <SortableContext id={status} items={tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.();
            }}
            title={t.board.expandColumn}
            aria-label={`${t.board.expandColumn}: ${title}`}
            aria-expanded={false}
            className="ui-focus flex flex-1 flex-col items-center gap-3 rounded-[12px] pb-3 pt-4"
          >
            <span
              aria-hidden
              className={clsx("ui-dot", hasActiveAgent && "ui-dot--live")}
              style={{ "--dot": tone.fill } as CSSProperties}
            />
            <span className="lane__count">{tasks.length}</span>
            <span
              className="text-[13px] font-bold tracking-[0.02em] text-ink"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {title}
            </span>
            <span className="mt-auto text-ink-3" aria-hidden>
              <IconChevronRight size={14} />
            </span>
          </button>
        </SortableContext>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      data-over={overState}
      data-target={dropTarget ?? undefined}
      aria-label={`${title} · ${tasks.length}`}
      className="lane min-w-[272px] max-w-[380px] flex-1 basis-0"
      style={laneStyle}
    >
      {hasActiveAgent && <span aria-hidden className="lane__scan" />}

      <header className="lane__head">
        <span
          aria-hidden
          className={clsx("ui-dot", hasActiveAgent && "ui-dot--live")}
          style={{ "--dot": tone.fill } as CSSProperties}
        />
        <h2 className="min-w-0 truncate text-[14px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
        <span className="lane__count">{tasks.length}</span>
        <span className="flex-1" />
        {isOver && dropTarget === "confirm" && (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--orange-text)]">
            {t.board.needsConfirm}
          </span>
        )}
        {onAddTask && (
          <IconButton label={t.board.addTask} size="sm" variant="ghost" onClick={onAddTask}>
            <IconPlus size={15} />
          </IconButton>
        )}
        <IconButton
          label={t.board.collapseColumn}
          size="sm"
          variant="ghost"
          onClick={onToggleCollapse}
          aria-expanded
        >
          <IconChevronLeft size={15} />
        </IconButton>
      </header>

      <SortableContext id={status} items={tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 pb-3 pt-1">
          {loading && tasks.length === 0 &&
            [0, 1].map((i) => (
              <div
                key={i}
                aria-hidden
                className="ui-hatch h-[96px] shrink-0 animate-pulse rounded-[12px] border-2 border-dashed border-[color-mix(in_srgb,var(--line)_30%,transparent)]"
              />
            ))}
          {!loading && tasks.length === 0 && (
            <div className="ui-hatch flex flex-col items-start gap-1.5 rounded-[12px] border-2 border-dashed border-[color-mix(in_srgb,var(--line)_35%,transparent)] px-4 py-5">
              <p className="flex items-center gap-2 text-[14px] font-bold text-ink-2">
                {planning && (
                  <span aria-hidden className="text-[var(--cobalt-text)]">
                    <IconSpinner size={13} />
                  </span>
                )}
                {emptyState.title}
              </p>
              <p className="text-[12px] leading-relaxed text-ink-3">{emptyState.hint}</p>
              {onAddTask && !planning && (
                <Button size="sm" variant="secondary" icon={<IconPlus size={14} />} onClick={onAddTask} className="mt-2">
                  {t.board.addTask}
                </Button>
              )}
            </div>
          )}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              subtasks={subtaskStats[task.id]}
              parentKey={task.parentTaskId ? keyById[task.parentTaskId] : undefined}
            />
          ))}
          {onAddTask && tasks.length > 0 && (
            <button
              type="button"
              onClick={onAddTask}
              className="ui-focus flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-semibold text-ink-3 transition hover:bg-hair hover:text-ink"
            >
              <IconPlus size={14} />
              {t.board.addTask}
            </button>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
