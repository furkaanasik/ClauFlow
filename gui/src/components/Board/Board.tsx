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

const COLUMN_STATUSES: TaskStatus[] = ["todo", "doing", "ci", "review", "done"];
const COLUMN_NUMERALS: Record<TaskStatus, string> = {
  todo:   "01",
  doing:  "02",
  ci:     "03",
  review: "04",
  done:   "05",
};

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo:   ["doing"],
  doing:  [],
  ci:     ["review"],
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
      todo: [], doing: [], ci: [], review: [], done: [],
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
      if (["todo", "doing", "ci", "review", "done"].includes(maybeCol)) {
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "24px 28px" }}>
        <div style={{ fontSize: 32, opacity: 0.3 }}>◻</div>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--cf-text)" }}>No project selected</p>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--cf-muted)" }}>Pick one from the settings (⚙), or create a new project.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "24px 28px",
        flex: 1,
        overflowX: "auto",
        overflowY: "auto",
      }}
    >
      {/* ── Board header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cf-text)", margin: 0 }}>Board</h2>
        <span style={{ fontSize: 12, color: "var(--cf-muted)" }}>·</span>
        {columns.some((c) => c.status === "doing" && byStatus.doing.some((t) => t.agent?.status !== "idle" && t.agent?.status !== "done" && t.agent?.status !== "error")) && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: 20,
            padding: "2px 10px",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
            <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 500 }}>agents running</span>
          </div>
        )}
        <span style={{ flex: 1 }} />
        <input
          ref={searchRef}
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={t.board.searchPlaceholder}
          style={{
            background: "var(--cf-card)",
            border: "1px solid var(--cf-border)",
            borderRadius: 7,
            padding: "5px 12px",
            fontSize: 12,
            color: "var(--cf-text)",
            outline: "none",
            width: 180,
            fontFamily: "monospace",
          }}
          onFocus={(e) => { e.target.style.borderColor = "#6366f1"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--cf-border)"; }}
        />
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
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flex: 1 }}>
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
