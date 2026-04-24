"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AgentBadge } from "@/components/Card/AgentBadge";
import { useBoardStore } from "@/store/boardStore";
import type { Task } from "@/types";

function isQueued(task: Task): boolean {
  return task.status === "doing" && task.agent.status === "idle";
}

function showAgentBadge(task: Task): boolean {
  if (isQueued(task)) return false; // kuyruk badge'i ayrı render ediliyor
  const { status: agentStatus } = task.agent;
  if (agentStatus === "idle") return false;
  if (task.status === "doing") return true;
  return agentStatus === "done" || agentStatus === "error";
}

/* Sol kenardaki accent bar rengi */
const PRIORITY_ACCENT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-yellow-500",
  low:      "bg-emerald-500",
};

/* Karti cevreleyen border/ring rengi */
const PRIORITY_BORDER: Record<string, string> = {
  critical: "border-red-500/50 ring-1 ring-red-500/30",
  high:     "border-orange-500/40 ring-1 ring-orange-500/20",
  medium:   "border-yellow-600/40",
  low:      "border-emerald-700/40",
};

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const selectTask = useBoardStore((s) => s.selectTask);
  const newTaskIds = useBoardStore((s) => s.newTaskIds);
  const clearNewTaskId = useBoardStore((s) => s.clearNewTaskId);

  const isNew = newTaskIds.has(task.id);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (!isNew) return;
    // Trigger animation on mount then clear the flag after animation completes
    const frame = requestAnimationFrame(() => setAnimated(true));
    const timer = setTimeout(() => {
      clearNewTaskId(task.id);
    }, 500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAgentWorking =
    task.agent &&
    task.agent.status !== "idle" &&
    task.agent.status !== "done" &&
    task.agent.status !== "error";

  const prio       = (task.priority ?? "").toLowerCase();
  const accentBar  = PRIORITY_ACCENT[prio] ?? "";
  const borderCls  = PRIORITY_BORDER[prio] ?? "border-zinc-800";

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      data: { status: task.status },
      disabled: isAgentWorking,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) selectTask(task.id); }}
      className={clsx(
        "group relative cursor-grab overflow-hidden rounded-xl border bg-gradient-to-br from-zinc-900 to-zinc-900/60 shadow-sm transition-all",
        "hover:bg-zinc-800/80 hover:shadow-md hover:shadow-black/20",
        borderCls,
        isDragging     && "opacity-40 scale-95",
        isAgentWorking && "cursor-not-allowed",
        // Drop-in animation for WS-pushed tasks
        isNew && !animated && "opacity-0 scale-95 -translate-y-2",
        isNew && animated && "opacity-100 scale-100 translate-y-0",
        isNew && "duration-400 ease-out",
      )}
    >
      {/* Sırada bekleyen task — statik progress bar */}
      {isQueued(task) && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-zinc-700/60" />
      )}

      {/* Agent calisirken animasyonlu progress serit */}
      {isAgentWorking && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/2 animate-pulse bg-yellow-400/70" />
        </div>
      )}

      {/* Oncelik accent bar */}
      {accentBar && (
        <div className={clsx("absolute inset-y-0 left-0 w-0.5", accentBar)} />
      )}

      <div className="px-3 py-3 pl-4">
        {/* Baslik */}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100">
          {task.title}
        </h3>

        {/* Aciklama */}
        {task.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">
            {task.description}
          </p>
        )}

        {/* Ayirici */}
        <div className="my-2.5 h-px bg-zinc-800/60" />

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-zinc-600">
            #{task.id.slice(0, 8)}
          </span>
          <div className="flex items-center gap-2">
            {isQueued(task) && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800/80 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                Sırada
              </span>
            )}
            {showAgentBadge(task) && (
              <AgentBadge agent={task.agent} taskTitle={task.title} />
            )}
            {task.prUrl && task.status !== "done" && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Pull Request ac"
                className="text-[10px] text-purple-400 hover:text-purple-300 transition"
              >
                PR↗
              </a>
            )}
          </div>
        </footer>

        {task.status === "done" && task.prUrl && (
          <div className="mt-2">
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-full bg-purple-900/40 px-2 py-0.5 text-[10px] font-medium text-purple-300 transition hover:bg-purple-900/60"
            >
              {task.prNumber ? `PR #${task.prNumber}` : "PR"} · Merged ✓
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
