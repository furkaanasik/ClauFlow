"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AgentBadge } from "@/components/Card/AgentBadge";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
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

/* Priority badge pill rengi */
const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  high:     "bg-orange-500/20 text-orange-400",
  medium:   "bg-yellow-500/20 text-yellow-400",
  low:      "bg-zinc-700 text-zinc-400",
};

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const selectTask = useBoardStore((s) => s.selectTask);
  const selectPRTask = useBoardStore((s) => s.selectPRTask);
  const newTaskIds = useBoardStore((s) => s.newTaskIds);
  const clearNewTaskId = useBoardStore((s) => s.clearNewTaskId);
  const t = useTranslation();

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
  const badgeCls   = PRIORITY_BADGE[prio] ?? "";

  const visibleTags = (task.tags ?? []).slice(0, 3);
  const extraTags   = (task.tags ?? []).length - visibleTags.length;

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
      style={{
        ...style,
        background:  "var(--bg-surface)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; }}
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) selectTask(task.id); }}
      className={clsx(
        "group relative cursor-grab overflow-hidden rounded-xl border shadow-sm transition-all",
        "hover:shadow-md hover:shadow-black/20",
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

      <div className="px-2.5 py-2.5 pl-3.5">
        {/* Baslik */}
        <h3 className="line-clamp-2 text-sm leading-snug text-zinc-100">
          {task.displayId && (
            <code className="mr-1.5 rounded bg-zinc-800 px-1 py-0.5 font-mono text-[10px] font-bold text-zinc-300">
              {task.displayId}
            </code>
          )}
          <span className="font-semibold">{task.title}</span>
        </h3>

        {/* Aciklama */}
        {task.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
            {task.description}
          </p>
        )}

        {/* Priority badge + tags */}
        {(badgeCls || visibleTags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-0.5">
            {badgeCls && (
              <span className={clsx("rounded-full px-1.5 py-0.5 text-[9px] font-medium", badgeCls)}>
                {prio}
              </span>
            )}
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300"
              >
                {tag}
              </span>
            ))}
            {extraTags > 0 && (
              <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400">
                +{extraTags}
              </span>
            )}
          </div>
        )}

        {/* Ayirici */}
        <div className="my-2 h-px bg-zinc-800/60" />

        {/* Footer */}
        <footer className="flex items-center justify-between gap-1.5">
          <span className="font-mono text-[10px] text-zinc-600">
            {task.displayId ?? `#${task.id.slice(0, 8)}`}
          </span>
          <div className="flex items-center gap-1.5">
            {isQueued(task) && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                Sırada
              </span>
            )}
            {showAgentBadge(task) && (
              <AgentBadge agent={task.agent} taskTitle={task.title} />
            )}
            {task.prNumber && task.status !== "done" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectPRTask(task.id);
                }}
                title={t.taskCard.openDiffTitle}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-1 py-0.5 text-[9px] font-medium text-[var(--accent-primary)] transition hover:border-[var(--accent-primary)]/60 hover:bg-[var(--accent-primary)]/20"
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M5 3.254V3.25v.005a.75.75 0 1 1 0-.005zM4.25 1A2.25 2.25 0 0 0 3.5 5.372V10.5h-.025a.75.75 0 0 0 0 1.5H3.5v.628a2.251 2.251 0 1 0 1.5 0V12h.025a.75.75 0 0 0 0-1.5H5V5.372A2.25 2.25 0 0 0 4.25 1zM3.5 13.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zM12 5h.025a.75.75 0 0 0 0-1.5H12V3a2.25 2.25 0 0 0-2.5 2.236V10a2.5 2.5 0 0 1-2.5 2.5H7v1.5h-.025a.75.75 0 0 0 0 1.5H7v.5h2v-.5h.025a.75.75 0 0 0 0-1.5H9v-1.563A4 4 0 0 0 12 9V5z"/>
                </svg>
                {t.taskCard.diffButton} #{task.prNumber}
              </button>
            )}
          </div>
        </footer>

        {task.status === "done" && task.prNumber && (
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectPRTask(task.id);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-primary)]/10 px-1.5 py-0.5 text-[9px] font-medium text-[var(--accent-primary)] transition hover:bg-[var(--accent-primary)]/20"
            >
              PR #{task.prNumber} · Merged ✓
            </button>
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={t.taskCard.openOnGithubTitle}
                className="text-[10px] text-purple-400 hover:text-purple-300 transition"
              >
                ↗
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
