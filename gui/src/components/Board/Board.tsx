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

  const toast          = useToast();

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

  // Klavye kisayollari
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
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-base text-zinc-500">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden>
            <rect x="1" y="1" width="5" height="11" rx="1.5" fill="currentColor" opacity="0.4" />
            <rect x="8" y="1" width="5" height="8"  rx="1.5" fill="currentColor" opacity="0.4" />
            <rect x="15" y="1" width="4" height="15" rx="1.5" fill="currentColor" opacity="0.4" />
          </svg>
        </div>
        <span>Soldan bir proje sec ya da yeni proje olustur.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Board header — istatistik + arama */}
      <div className="kanban-panel flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5">
        {/* Stat pills */}
        <div className="flex flex-wrap gap-2">
          {columns.map((col) => {
            const count = Object.values(tasks).filter(
              (t) => t?.projectId === selectedProjectId && t.status === col.status,
            ).length;
            return (
              <span
                key={col.status}
                className="rounded-md bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-400"
              >
                {col.title}:{" "}
                <span className="font-semibold text-zinc-200">{count}</span>
              </span>
            );
          })}
        </div>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-zinc-500">
              %{progressPct}
            </span>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Arama */}
        <div className="relative ml-auto flex-shrink-0">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-600">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
            </svg>
          </span>
          <input
            ref={searchRef}
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={t.board.searchPlaceholder}
            className="kanban-search rounded-lg border border-[var(--border)] bg-[var(--bg-base)] py-1.5 pl-8.5 pr-3 text-sm text-[var(--text-primary)] placeholder-zinc-600 outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/20 w-56"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="absolute inset-y-0 right-2.5 flex items-center text-zinc-600 hover:text-zinc-400"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {t.board.loadError}: {error}
        </div>
      )}
      {loading && (
        <div className="text-sm text-zinc-500">{t.board.loadingTasks}</div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((col) => (
            <BoardColumn
              key={col.status}
              status={col.status}
              title={col.title}
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

      {/* Kisayol yardim overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-96 rounded-2xl border p-5 shadow-2xl"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-semibold" style={{ color: "var(--text-primary)" }}>{t.board.shortcuts.title}</h3>
            <div className="flex flex-col gap-2">
              {[
                { key: "N",   desc: t.board.shortcuts.newTask },
                { key: "/",   desc: t.board.shortcuts.focusSearch },
                { key: "Esc", desc: t.board.shortcuts.close },
                { key: "?",   desc: t.board.shortcuts.openHelp },
              ].map(({ key, desc }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>{desc}</span>
                  <kbd className="rounded border px-2 py-1 font-mono text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-4 w-full rounded-lg border py-2 text-sm transition"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-primary)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
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
