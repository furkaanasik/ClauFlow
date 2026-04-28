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
  if (isQueued(task)) return false;
  const { status: agentStatus } = task.agent;
  if (agentStatus === "idle") return false;
  if (task.status === "doing") return true;
  return agentStatus === "done" || agentStatus === "error";
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: "var(--prio-critical)",
  high:     "var(--prio-high)",
  medium:   "var(--prio-medium)",
  low:      "var(--prio-low)",
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: "p0",
  high:     "p1",
  medium:   "p2",
  low:      "p3",
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
  const prioColor  = PRIORITY_COLOR[prio];
  const prioLabel  = PRIORITY_LABEL[prio];

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

  const cardId = task.displayId ?? `#${task.id.slice(0, 7)}`;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) selectTask(task.id); }}
      className={clsx(
        "group relative cursor-grab overflow-hidden border border-[var(--border)] bg-[var(--bg-base)] transition-all",
        "hover:border-[var(--border-strong)]",
        isDragging     && "opacity-40",
        isAgentWorking && "cursor-not-allowed",
        isNew && !animated && "opacity-0 -translate-y-2",
        isNew && animated  && "opacity-100 translate-y-0",
        isNew              && "duration-500 ease-out",
      )}
    >
      {/* queued progress strip */}
      {isQueued(task) && (
        <div className="absolute inset-x-0 top-0 h-px bg-[var(--border-strong)]" />
      )}

      {/* active scan line */}
      {isAgentWorking && (
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1/3 animate-scan bg-[var(--accent-primary)]" />
        </div>
      )}

      {/* priority side wedge */}
      {prioColor && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: prioColor }}
        />
      )}

      <div className="px-4 py-3.5 pl-5">
        {/* metadata row */}
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] text-[var(--text-faint)]">
            {cardId}
          </span>
          {prioLabel && (
            <span
              className="font-mono text-[10px] uppercase tracking-widest"
              style={{ color: prioColor }}
              title={prio}
            >
              {prio}
            </span>
          )}
        </div>

        {/* title */}
        <h3 className="t-display line-clamp-2 text-[1.25rem] leading-[1.2] text-[var(--text-primary)]">
          {task.title}
        </h3>

        {/* description */}
        {task.description && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
            {task.description}
          </p>
        )}

        {/* tags */}
        {visibleTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]"
              >
                {tag}
              </span>
            ))}
            {extraTags > 0 && (
              <span className="text-[11px] text-[var(--text-faint)]">
                +{extraTags}
              </span>
            )}
          </div>
        )}

        {/* footer with hairline */}
        {(isQueued(task) || showAgentBadge(task) || (task.prNumber && task.status !== "done")) && (
          <footer className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-2.5">
            {isQueued(task) && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <span className="h-1 w-1 bg-[var(--text-faint)]" />
                Queued
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
                className="inline-flex items-center gap-1 border border-[var(--accent-primary)] bg-[var(--accent-muted)] px-2 py-1 text-[11px] text-[var(--accent-primary)] transition hover:bg-[var(--accent-primary)] hover:text-[var(--accent-ink)]"
              >
                {t.taskCard.diffButton} #{task.prNumber}
              </button>
            )}
          </footer>
        )}

        {task.status === "done" && task.prNumber && (
          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectPRTask(task.id);
              }}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent-primary)] transition hover:opacity-80"
            >
              <span className="h-1 w-1 bg-[var(--accent-primary)]" />
              PR #{task.prNumber} · Merged
            </button>
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={t.taskCard.openOnGithubTitle}
                className="font-mono text-xs text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
              >
                ↗
              </a>
            )}
          </div>
        )}
      </div>

      {/* hover accent line */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-px w-0 bg-[var(--accent-primary)] transition-all duration-500 group-hover:w-full"
      />
    </article>
  );
}
