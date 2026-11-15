"use client";

import clsx from "clsx";
import { useEffect, useState, type CSSProperties, type HTMLAttributes, type PointerEvent, type Ref } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AgentBadge } from "@/components/Card/AgentBadge";
import { CiBadge } from "@/components/Card/CiBadge";
import { PriorityMark, StatusPill, type PriorityLevel } from "@/components/ui/Pills";
import { IconArrowUpRight, IconClose, IconCoin, IconPR, IconSubtask } from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { api } from "@/lib/api";
import {
  formatUsd,
  isAgentWorking,
  isQueued,
  tagDot,
  taskCost,
  type SubtaskStats,
} from "@/lib/boardView";
import type { Task } from "@/types";

const PRIORITY_FILL: Record<PriorityLevel, string> = {
  low: "var(--ink-3)",
  medium: "var(--cobalt)",
  high: "var(--orange)",
  critical: "var(--red)",
};

function showAgentBadge(task: Task): boolean {
  if (isQueued(task)) return false;
  const s = task.agent.status;
  if (s === "idle") return false;
  if (task.status === "doing") return true;
  return s === "done" || s === "error";
}

export interface TaskCardProps {
  task: Task;
  /** Child-task progress when this task is a parent. */
  subtasks?: SubtaskStats;
  /** Display key of the parent when this task is a subtask. */
  parentKey?: string;
}

/** Sortable board card. Listeners sit on the whole card (spec §7). */
export function TaskCard({ task, subtasks, parentKey }: TaskCardProps) {
  const selectTask = useBoardStore((s) => s.selectTask);
  const working = isAgentWorking(task);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
    disabled: working,
  });

  return (
    <TaskCardView
      task={task}
      subtasks={subtasks}
      parentKey={parentKey}
      nodeRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      dndProps={{ ...attributes, ...listeners }}
      dragging={isDragging}
      onOpen={() => {
        if (!isDragging) selectTask(task.id);
      }}
    />
  );
}

interface TaskCardViewProps extends TaskCardProps {
  nodeRef?: Ref<HTMLElement>;
  style?: CSSProperties;
  dndProps?: HTMLAttributes<HTMLElement>;
  dragging?: boolean;
  /** Rendered inside the DragOverlay: tilted, lifted, no sortable hooks. */
  overlay?: boolean;
  onOpen?: () => void;
}

/** Presentational card — shared by the sortable card, the drag overlay and the styleguide. */
export function TaskCardView({
  task,
  subtasks,
  parentKey,
  nodeRef,
  style,
  dndProps,
  dragging = false,
  overlay = false,
  onOpen,
}: TaskCardViewProps) {
  const t = useTranslation();
  const selectPRTask = useBoardStore((s) => s.selectPRTask);
  const newTaskIds = useBoardStore((s) => s.newTaskIds);
  const ciIterations = useBoardStore((s) => s.ciIterations);
  const clearNewTaskId = useBoardStore((s) => s.clearNewTaskId);
  const overBudget = useBoardStore((s) => Boolean(s.budgetExceeded[task.id]));
  const [cancelling, setCancelling] = useState(false);

  const isNew = !overlay && newTaskIds.has(task.id);
  const [entered, setEntered] = useState(!isNew);

  useEffect(() => {
    if (!isNew) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    const timer = setTimeout(() => clearNewTaskId(task.id), 500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const working = isAgentWorking(task);
  const queued = isQueued(task);
  const prio = (task.priority ?? "").toLowerCase() as PriorityLevel | "";
  const prioLabel = prio ? t.addTask.priorities[prio] : "";
  const tags = task.tags ?? [];
  const visibleTags = tags.slice(0, 3);
  const extraTags = tags.length - visibleTags.length;
  const cost = taskCost(task);
  const cardKey = task.displayId ?? `#${task.id.slice(0, 7)}`;
  const hasSubtasks = Boolean(subtasks && subtasks.total > 0);
  const openPR = Boolean(task.prNumber) && task.status !== "done";
  const mergedPR = Boolean(task.prNumber) && task.status === "done";
  const agentPill = showAgentBadge(task) && task.status !== "ci";

  const hasFooter =
    hasSubtasks || cost !== null || queued || task.status === "ci" || openPR || mergedPR || (agentPill && !working);

  const stop = {
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  };

  return (
    <article
      ref={nodeRef as Ref<HTMLElement>}
      style={{
        ...style,
        ...(isNew && !entered ? { opacity: 0, translate: "0 -8px" } : null),
        ...(isNew ? { transition: `${style?.transition ? `${style.transition}, ` : ""}opacity 500ms ease-out, translate 500ms ease-out` } : null),
      }}
      {...dndProps}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen?.();
        }
      }}
      aria-label={`${cardKey} ${task.title}`}
      title={working ? t.taskCard.dragLocked : undefined}
      data-running={working || undefined}
      data-locked={working || undefined}
      data-dragging={dragging || undefined}
      data-task-id={task.id}
      className={clsx("task-card group", overlay && "task-card--overlay")}
    >
      {working ? (
        <span aria-hidden className="task-card__edge" />
      ) : (
        prio && (
          <span
            aria-hidden
            className="task-card__prio"
            style={{ "--prio": PRIORITY_FILL[prio] } as CSSProperties}
          />
        )
      )}

      <div className={clsx("py-3 pr-3", working ? "pl-[1.35rem]" : "pl-4")}>
        {/* key · parent · priority */}
        <div className="flex items-center gap-2">
          <span className="task-card__key">{cardKey}</span>
          {parentKey && (
            <span
              className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-ink-3"
              title={t.taskCard.subtaskOf.replace("{key}", parentKey)}
            >
              <IconSubtask size={12} />
              <span className="truncate">{parentKey}</span>
            </span>
          )}
          <span className="flex-1" />
          {prio && <PriorityMark level={prio} label={prioLabel} />}
        </div>

        <h3 className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
          {task.title}
        </h3>

        {task.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.45] text-ink-3">{task.description}</p>
        )}

        {visibleTags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-paper px-2 text-[11px] font-medium text-ink-2"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: tagDot(tag) }}
                />
                {tag}
              </span>
            ))}
            {extraTags > 0 && <span className="font-mono text-[11px] text-ink-3">+{extraTags}</span>}
          </div>
        )}

        {/* live agent step — full row while the executor runs */}
        {working && agentPill && (
          <div className="mt-3 flex items-center" {...stop}>
            <AgentBadge agent={task.agent} taskTitle={task.title} />
          </div>
        )}

        {hasFooter && (
          <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t-[1.5px] border-hair pt-2.5">
            {hasSubtasks && subtasks && (
              <span className="task-card__meta" title={t.taskCard.subtasks.replace("{done}", String(subtasks.done)).replace("{total}", String(subtasks.total))}>
                <IconSubtask size={12} />
                {subtasks.done}/{subtasks.total}
              </span>
            )}
            {cost !== null && (
              <span
                className="task-card__meta"
                style={overBudget ? { background: "var(--red)", color: "var(--on-red)" } : undefined}
                title={overBudget ? t.taskCard.overBudget : t.taskCard.cost}
              >
                <IconCoin size={12} />
                {formatUsd(cost)}
              </span>
            )}

            <span className="flex-1" />

            {queued && (
              <span className="inline-flex items-center gap-1" {...stop}>
                <StatusPill status="todo">{t.taskCard.queued}</StatusPill>
                <button
                  type="button"
                  aria-label={t.taskCard.cancelQueuedTitle}
                  title={t.taskCard.cancelQueuedTitle}
                  disabled={cancelling}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setCancelling(true);
                    try {
                      await api.abortTask(task.id);
                    } catch {
                      /* ignore */
                    }
                    setCancelling(false);
                  }}
                  className="task-card__btn !w-6 !justify-center !px-0 hover:!bg-red hover:!text-[var(--on-red)]"
                >
                  <IconClose size={11} />
                </button>
              </span>
            )}

            {task.status === "ci" && (
              <CiBadge
                iteration={ciIterations[task.id]?.iteration ?? 0}
                maxIterations={ciIterations[task.id]?.maxIterations ?? 3}
                lastConclusion="pending"
              />
            )}

            {agentPill && !working && (
              <span {...stop}>
                <AgentBadge agent={task.agent} taskTitle={task.title} />
              </span>
            )}

            {openPR && (
              <button
                type="button"
                {...stop}
                onClick={(e) => {
                  e.stopPropagation();
                  selectPRTask(task.id);
                }}
                title={t.taskCard.openDiffTitle}
                className="task-card__btn"
                style={{ background: "var(--cobalt)", color: "var(--on-cobalt)" }}
              >
                <IconPR size={12} />#{task.prNumber}
              </button>
            )}

            {mergedPR && (
              <span className="inline-flex items-center gap-1" {...stop}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectPRTask(task.id);
                  }}
                  className="task-card__btn"
                  style={{ background: "var(--green)", color: "var(--on-green)" }}
                >
                  <IconPR size={12} />#{task.prNumber} · {t.taskCard.merged}
                </button>
                {task.prUrl && (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={t.taskCard.openOnGithubTitle}
                    aria-label={t.taskCard.openOnGithubTitle}
                    className="task-card__btn !w-6 !justify-center !px-0"
                  >
                    <IconArrowUpRight size={12} />
                  </a>
                )}
              </span>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}
