"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BoardColumn } from "@/components/Board/BoardColumn";
import { TaskCard } from "@/components/Card/TaskCard";
import { TaskDetailDrawer } from "@/components/Card/TaskDetailDrawer";
import { AddTaskModal } from "@/components/Modals/AddTaskModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PRDetailDrawer, type PullRequest } from "@/components/Github/PRDetailDrawer";
import { useBoardTasks, moveTaskOptimistic } from "@/hooks/useBoard";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { useBoardStore } from "@/store/boardStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import type { TaskStatus } from "@/types";

const COLUMN_STATUSES: TaskStatus[] = ["todo", "doing", "review", "done"];
const COLUMN_NUMERALS: Record<TaskStatus, string> = {
  todo: "01",
  doing: "02",
  review: "03",
  done: "04",
};

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo:   ["doing"],
  doing:  [],
  review: ["done"],
  done:   [],
};

export function Board() {
  const { loading, error } = useBoardTasks();
  useAgentSocket();
  const t = useTranslation();
  const columns = COLUMN_STATUSES.map((status) => ({
    status,
    title: t.board.columns[status],
    numeral: COLUMN_NUMERALS[status],
  }));

  const tasks             = useBoardStore((s) => s.tasks);
  const order             = useBoardStore((s) => s.order);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const filterText        = useBoardStore((s) => s.filterText);
  const setFilterText     = useBoardStore((s) => s.setFilterText);
  const selectTask        = useBoardStore((s) => s.selectTask);
  const selectedTaskId    = useBoardStore((s) => s.selectedTaskId);
  const selectedPRTaskId  = useBoardStore((s) => s.selectedPRTaskId);
  const selectPRTask      = useBoardStore((s) => s.selectPRTask);
  const upsertTask        = useBoardStore((s) => s.upsertTask);

  const toast = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedProjectId == null) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("projectId") === selectedProjectId) return;
    params.set("projectId", selectedProjectId);
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
  }, [selectedProjectId]);

  const [activeId, setActiveId]     = useState<string | null>(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [showHelp, setShowHelp]     = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pendingMove, setPendingMove] = useState<{ taskId: string; from: TaskStatus; to: TaskStatus } | null>(null);

  useKeyboardShortcuts({
    onNewTask:     useCallback(() => setAddOpen(true), []),
    onEscape:      useCallback(() => {
      if (selectedTaskId) selectTask(null);
      else if (showHelp)  setShowHelp(false);
      else if (addOpen)   setAddOpen(false);
    }, [selectedTaskId, showHelp, addOpen, selectTask]),
    onFocusSearch: useCallback(() => searchRef.current?.focus(), []),
    onShowHelp:    useCallback(() => setShowHelp((v) => !v), []),
  });

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, typeof tasks[string][]> = {
      todo: [], doing: [], review: [], done: [],
    };
    const needle = filterText.trim().toLowerCase();
    for (const id of order) {
      const t = tasks[id];
      if (!t) continue;
      if (needle) {
        const match =
          t.title.toLowerCase().includes(needle) ||
          (t.description ?? "").toLowerCase().includes(needle);
        if (!match) continue;
      }
      map[t.status].push(t);
    }
    return map;
  }, [tasks, order, filterText]);

  const totalCount = Object.values(tasks).filter(
    (t) => t?.projectId === selectedProjectId,
  ).length;
  const doneCount = Object.values(tasks).filter(
    (t) => t?.projectId === selectedProjectId && t.status === "done",
  ).length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeTask = activeId ? tasks[activeId] : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const task   = tasks[taskId];
    if (!task) return;

    const overData = over.data.current as { status?: TaskStatus } | undefined;
    let target: TaskStatus | undefined = overData?.status;
    if (!target) {
      const maybeCol = String(over.id);
      if (["todo", "doing", "review", "done"].includes(maybeCol)) {
        target = maybeCol as TaskStatus;
      }
    }
    if (!target || target === task.status) return;

    if (!ALLOWED_TRANSITIONS[task.status].includes(target)) {
      setPendingMove({ taskId, from: task.status, to: target });
      return;
    }

    try {
      await moveTaskOptimistic(taskId, target);
      if (target === "doing")  toast.info(t.board.agentStarted);
      if (target === "done")   toast.success("PR merge edildi");
    } catch (err) {
      toast.error(`Tasima basarisiz: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
        <div className="flex h-14 w-14 items-center justify-center border border-[var(--border)] text-[var(--text-muted)]">
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden>
            <rect x="1" y="1" width="5" height="11" rx="0" fill="currentColor" opacity="0.4" />
            <rect x="8" y="1" width="5" height="8"  rx="0" fill="currentColor" opacity="0.4" />
            <rect x="15" y="1" width="4" height="15" rx="0" fill="currentColor" opacity="0.4" />
          </svg>
        </div>
        <div className="text-center">
          <p className="t-display text-3xl text-[var(--text-primary)]">No project selected</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Pick one from the left, or create a new project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Board header ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="t-display text-4xl leading-tight text-[var(--text-primary)] md:text-5xl">
              Board
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Drag a task to <span className="text-[var(--accent-primary)]">DOING</span> — Claude opens a PR.
            </p>
          </div>
          <div className="flex items-center gap-5">
            <Stat label="Total" value={totalCount} />
            <span className="h-9 w-px bg-[var(--border)]" />
            <Stat label="Done" value={doneCount} accent />
            <span className="h-9 w-px bg-[var(--border)]" />
            <div className="w-40">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-[var(--text-muted)]">Progress</span>
                <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                  {progressPct}%
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden bg-[var(--bg-sunken)]">
                <div
                  className="h-full bg-[var(--accent-primary)] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stat strip + search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {columns.map((col) => {
              const count = Object.values(tasks).filter(
                (t) => t?.projectId === selectedProjectId && t.status === col.status,
              ).length;
              return (
                <span
                  key={col.status}
                  className="flex items-center gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5"
                >
                  <span className="text-[12px] text-[var(--text-secondary)]">{col.title}</span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                    {count}
                  </span>
                </span>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative ml-auto">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-faint)]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
              </svg>
            </span>
            <input
              ref={searchRef}
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t.board.searchPlaceholder}
              className="kanban-search w-64 border border-[var(--border)] bg-[var(--bg-surface)] py-2 pl-9 pr-9 text-[13px] outline-none transition focus:border-[var(--text-secondary)]"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[10px] text-[var(--text-faint)]">
              {filterText ? (
                <button
                  type="button"
                  onClick={() => setFilterText("")}
                  className="pointer-events-auto px-1 hover:text-[var(--text-primary)]"
                  aria-label="Clear"
                >
                  ✕
                </button>
              ) : (
                "/"
              )}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-sm text-[var(--status-error)]">
          {t.board.loadError}: {error}
        </div>
      )}
      {loading && (
        <div className="t-label">{t.board.loadingTasks}</div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((col) => (
            <BoardColumn
              key={col.status}
              status={col.status}
              title={col.title}
              numeral={col.numeral}
              tasks={byStatus[col.status]}
              onAddTask={col.status === "todo" ? () => setAddOpen(true) : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      <TaskDetailDrawer />

      {(() => {
        const prTask = selectedPRTaskId ? tasks[selectedPRTaskId] : null;
        if (!prTask || !prTask.prNumber || !selectedProjectId) return null;
        const pr: PullRequest = {
          number: prTask.prNumber,
          title: prTask.title,
          state: prTask.status === "done" ? "MERGED" : "OPEN",
          url: prTask.prUrl ?? "",
          author: { login: "agent" },
          createdAt: prTask.updatedAt,
        };
        return (
          <PRDetailDrawer
            pr={pr}
            projectId={selectedProjectId}
            onClose={() => selectPRTask(null)}
            onMerged={() => {
              upsertTask({
                ...prTask,
                status: "done",
                updatedAt: new Date().toISOString(),
              });
              toast.success("PR merge edildi");
            }}
          />
        );
      })()}

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Help overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-96 border border-[var(--border)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="t-display mb-5 text-2xl text-[var(--text-primary)]">
              {t.board.shortcuts.title}
            </h3>
            <div className="flex flex-col">
              {[
                { key: "N",   desc: t.board.shortcuts.newTask },
                { key: "/",   desc: t.board.shortcuts.focusSearch },
                { key: "Esc", desc: t.board.shortcuts.close },
                { key: "?",   desc: t.board.shortcuts.openHelp },
              ].map(({ key, desc }) => (
                <div
                  key={key}
                  className="flex items-center justify-between border-b border-[var(--border)] py-2.5 last:border-b-0"
                >
                  <span className="text-sm text-[var(--text-secondary)]">{desc}</span>
                  <kbd className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)]">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="btn-ghost mt-5 w-full px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]"
            >
              {t.board.shortcuts.close}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingMove)}
        title={t.board.manualMove.title}
        description={
          pendingMove
            ? t.board.manualMove.descriptionTemplate
                .replace("{from}", t.board.columns[pendingMove.from])
                .replace("{to}", t.board.columns[pendingMove.to])
            : ""
        }
        confirmLabel={t.board.manualMove.confirm}
        cancelLabel={t.board.manualMove.cancel}
        variant="warning"
        onConfirm={async () => {
          if (!pendingMove) return;
          const { taskId, to } = pendingMove;
          setPendingMove(null);
          try {
            await moveTaskOptimistic(taskId, to);
            if (to === "doing") toast.info(t.board.agentStarted);
            if (to === "done")  toast.success("PR merge edildi");
          } catch (err) {
            toast.error(`Tasima basarisiz: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
        onCancel={() => setPendingMove(null)}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p
        className={`font-mono text-2xl font-semibold tabular-nums ${
          accent ? "text-[var(--accent-primary)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
