"use client";

import clsx from "clsx";
import { useEffect, useState, type CSSProperties, type HTMLAttributes, type PointerEvent, type Ref } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AgentBadge } from "@/components/Card/AgentBadge";
import { ChainBadge } from "@/components/Card/ChainBadge";
import { PriorityMark, StatusPill, type PriorityLevel } from "@/components/ui/Pills";
import { IconArrowUpRight, IconBranch, IconClose, IconCoin, IconPR, IconSubtask } from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { api } from "@/lib/api";
import { justArrivedDone } from "@/lib/doneBurst";
import {
  isAgentWorking,
  isAwaitingApproval,
  isQueued,
  isWaitingDeps,
  tagDot,
  unmetDeps,
  taskCost,
  type SubtaskStats,
} from "@/lib/boardView";
import { formatUsd } from "@/lib/format";
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
  if (s === "idle" || s === "waiting_deps") return false;
  if (task.status === "doing") return true;
  return s === "done" || s === "error";
}

interface TaskCardProps {
  task: Task;
  /** Child-task progress when this task is a parent. */
  subtasks?: SubtaskStats;
  /** Display key of the parent when this task is a subtask. */
  parentKey?: string;
}

/** Sortable board card. Listeners sit on the whole card (spec §7). */
export function TaskCard({ task, subtasks, parentKey }: TaskCardProps) {
  const selectTask = useBoardStore((s) => s.selectTask);
  // A run paused at the spec gate still owns the card: no drag until approve/cancel.
  // zincir: a waiting card does not drag either (leaving Doing is its cancel button).
  const locked = isAgentWorking(task) || isAwaitingApproval(task) || isWaitingDeps(task);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
    disabled: locked,
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
  const clearNewTaskId = useBoardStore((s) => s.clearNewTaskId);
  const overBudget = useBoardStore((s) => Boolean(s.budgetExceeded[task.id]));
  const tasks = useBoardStore((s) => s.tasks);
  const [cancelling, setCancelling] = useState(false);

  const isNew = !overlay && newTaskIds.has(task.id);
  const [entered, setEntered] = useState(!isNew);
  // DONE drop: a short confetti burst when the card lands in DONE
  const [burst, setBurst] = useState(() => !overlay && task.status === "done" && justArrivedDone(task.id));
  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(false), 900);
    return () => clearTimeout(timer);
  }, [burst]);

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
  const awaiting = isAwaitingApproval(task);
  const queued = isQueued(task);
  // zincir: waiting for dependencies (§5.6); `ready` = all done but not started (E5).
  const waiting = isWaitingDeps(task);
  const unmet = task.status === "todo" || waiting ? unmetDeps(task, tasks) : [];
  const ready = waiting && unmet.length === 0;
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
  // D1: in review without a PR, the work sits on a local branch (no remote).
  const localBranch = task.status === "review" && Boolean(task.branch) && !task.prNumber;
  const agentPill = showAgentBadge(task);

  const hasFooter =
    hasSubtasks ||
    cost !== null ||
    queued ||
    waiting ||
    unmet.length > 0 ||
    openPR ||
    mergedPR ||
    localBranch ||
    (agentPill && !working);

  const stop = {
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  };

  return (
    <div
      ref={nodeRef as Ref<HTMLDivElement>}
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
      title={working || awaiting ? t.taskCard.dragLocked : undefined}
      data-running={working || undefined}
      data-locked={working || awaiting || waiting || undefined}
      data-waiting={waiting || undefined}
      data-dragging={dragging || undefined}
      data-task-id={task.id}
      data-burst={burst || undefined}
      className={clsx("task-card group", overlay && "task-card--overlay")}
    >
      {burst && <DoneBurst />}
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
            <AgentBadge agent={task.agent} taskTitle={task.title} taskId={task.id} />
          </div>
        )}

        {hasFooter && (
          <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t-[1.5px] border-hair pt-2.5">
            <ChainBadge task={task} />
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

            {waiting && (
              <span className="inline-flex items-center gap-1" {...stop}>
                <StatusPill status="todo">{ready ? t.taskCard.readyToStart : t.taskCard.waitingDeps}</StatusPill>
                <button
                  type="button"
                  aria-label={t.taskCard.cancelWaitingTitle}
                  title={t.taskCard.cancelWaitingTitle}
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

            {agentPill && !working && (
              <span {...stop}>
                <AgentBadge agent={task.agent} taskTitle={task.title} taskId={task.id} />
              </span>
            )}

            {localBranch && task.branch && (
              <span className="task-card__meta" title={t.taskCard.localBranchTitle(task.branch)}>
                <IconBranch size={12} />
                {t.taskCard.localBranch}
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
    </div>
  );
}

const BURST_COLORS = ["var(--green)", "var(--mustard)", "var(--cobalt)", "var(--orange)"];

/** Confetti squares with ink edges that pop out of a card landing in DONE. */
function DoneBurst() {
  return (
    <span aria-hidden className="done-burst">
      {Array.from({ length: 14 }, (_, i) => (
        <i
          key={i}
          style={
            {
              "--a": `${i * (360 / 14) + (i % 2 ? 9 : -6)}deg`,
              "--d": `${46 + (i % 3) * 18}px`,
              "--c": BURST_COLORS[i % BURST_COLORS.length],
              "--s": `${i % 3 === 0 ? 11 : 8}px`,
              animationDelay: `${(i % 4) * 18}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
