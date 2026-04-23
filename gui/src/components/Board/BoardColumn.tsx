"use client";

import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "@/components/Card/TaskCard";
import type { Task, TaskStatus } from "@/types";

interface BoardColumnProps {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  onAddTask?: () => void;
}

/* Kolon sol border rengi */
const COLUMN_LEFT_BORDER: Record<TaskStatus, string> = {
  todo:   "border-l-zinc-600",
  doing:  "border-l-yellow-600",
  review: "border-l-purple-600",
  done:   "border-l-emerald-600",
};

/* Baslik rengi */
const COLUMN_TITLE_COLOR: Record<TaskStatus, string> = {
  todo:   "text-zinc-300",
  doing:  "text-yellow-300",
  review: "text-purple-300",
  done:   "text-emerald-300",
};

/* Count badge arka plan */
const COLUMN_BADGE: Record<TaskStatus, string> = {
  todo:   "bg-zinc-800 text-zinc-400",
  doing:  "bg-yellow-900/50 text-yellow-400",
  review: "bg-purple-900/50 text-purple-400",
  done:   "bg-emerald-900/50 text-emerald-400",
};

/* Bos state mesajlari */
const EMPTY_MSG: Record<TaskStatus, string> = {
  todo:   "Henuz gorev yok — + Ekle butonuna bas",
  doing:  "Surukle birak veya agent bekliyor",
  review: "PR inceleme bekliyor",
  done:   "Tamamlanan gorevler burada gorunur",
};

/* Kolonun ikonu */
const COLUMN_ICON: Record<TaskStatus, string> = {
  todo:   "○",
  doing:  "⚡",
  review: "◎",
  done:   "✓",
};

export function BoardColumn({ status, title, tasks, onAddTask }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });

  const hasActiveAgent =
    status === "doing" &&
    tasks.some(
      (t) =>
        t.agent.status !== "idle" &&
        t.agent.status !== "done" &&
        t.agent.status !== "error",
    );

  const handleAddClick = () => {
    onAddTask?.();
  };

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[60vh] w-full flex-col rounded-2xl border border-zinc-800/80 border-l-2 bg-zinc-950/60 p-3 transition-all",
        COLUMN_LEFT_BORDER[status],
        isOver          && "bg-zinc-900/80 ring-1 ring-blue-500/30",
        hasActiveAgent  && "shadow-[0_0_24px_rgba(250,204,21,0.12)]",
      )}
    >
      <header className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "text-sm",
              COLUMN_TITLE_COLOR[status],
              hasActiveAgent && "animate-pulse",
            )}
            aria-hidden
          >
            {COLUMN_ICON[status]}
          </span>
          <h2
            className={clsx(
              "text-xs font-semibold uppercase tracking-wider",
              COLUMN_TITLE_COLOR[status],
              hasActiveAgent && "animate-pulse",
            )}
          >
            {title}
          </h2>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium",
              COLUMN_BADGE[status],
            )}
          >
            {tasks.length}
          </span>
        </div>
        {status === "todo" && (
          <button
            type="button"
            onClick={handleAddClick}
            className="rounded-md px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            + Ekle
          </button>
        )}
      </header>

      <SortableContext
        id={status}
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800/80 p-6 text-center text-[11px] leading-relaxed text-zinc-600">
              {EMPTY_MSG[status]}
            </div>
          )}
        </div>
      </SortableContext>

    </section>
  );
}
