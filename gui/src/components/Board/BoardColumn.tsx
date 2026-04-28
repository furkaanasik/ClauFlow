"use client";

import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "@/components/Card/TaskCard";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task, TaskStatus } from "@/types";

interface BoardColumnProps {
  status: TaskStatus;
  title: string;
  numeral: string;
  tasks: Task[];
  onAddTask?: () => void;
}

const COLUMN_TONE: Record<TaskStatus, { dot: string; ink: string }> = {
  todo:   { dot: "var(--status-todo)",   ink: "var(--text-secondary)" },
  doing:  { dot: "var(--status-doing)",  ink: "var(--status-doing)" },
  review: { dot: "var(--status-review)", ink: "var(--status-review)" },
  done:   { dot: "var(--status-done)",   ink: "var(--status-done)" },
};

export function BoardColumn({ status, title, tasks, onAddTask }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });
  const t = useTranslation();
  const emptyState = t.board.emptyStates[status];
  const tone = COLUMN_TONE[status];

  const hasActiveAgent =
    status === "doing" &&
    tasks.some(
      (t) =>
        t.agent.status !== "idle" &&
        t.agent.status !== "done" &&
        t.agent.status !== "error",
    );

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "kanban-column relative flex min-h-[60vh] w-full flex-col border border-[var(--border)] transition-all",
        isOver && "border-[var(--accent-primary)]",
      )}
    >
      {/* header */}
      <header className="relative flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={clsx(
              "h-1.5 w-1.5",
              hasActiveAgent && "animate-pulse",
            )}
            style={{ backgroundColor: tone.dot }}
            aria-hidden
          />
          <h2
            className="text-[13px] font-semibold"
            style={{ color: tone.ink }}
          >
            {title}
          </h2>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {tasks.length}
          </span>
        </div>
        {status === "todo" && (
          <button
            type="button"
            onClick={onAddTask}
            className="text-[12px] text-[var(--text-muted)] transition hover:text-[var(--accent-primary)]"
          >
            + Add
          </button>
        )}

        {hasActiveAgent && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"
          >
            <span className="absolute inset-y-0 left-0 w-1/3 animate-scan bg-[var(--accent-primary)]" />
          </span>
        )}
      </header>

      <SortableContext
        id={status}
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3">
          {tasks.length === 0 && (
            <div className="flex flex-col items-start gap-2 border border-dashed border-[var(--border)] bg-[var(--bg-sunken)] p-5 text-left">
              <p className="t-display text-xl text-[var(--text-secondary)]">
                {emptyState.title}
              </p>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                {emptyState.hint}
              </p>
            </div>
          )}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}
