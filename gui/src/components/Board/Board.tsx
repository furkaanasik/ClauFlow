"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { BoardColumn } from "@/components/Board/BoardColumn";
import { BoardStats } from "@/components/Board/BoardStats";
import { PlannerBanner } from "@/components/Board/PlannerBanner";
import { QuickFilters } from "@/components/Board/QuickFilters";
import { TaskList } from "@/components/Board/TaskList";
import { FactoryView } from "@/components/Factory/FactoryView";
import { TaskCardView } from "@/components/Card/TaskCard";
import { TaskDetailDrawer } from "@/components/Card/TaskDetailDrawer";
import { AddTaskModal } from "@/components/Modals/AddTaskModal";
import { ImportIssuesModal } from "@/components/Modals/ImportIssuesModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Tooltip } from "@/components/ui/Tooltip";
import { SectionPill } from "@/components/ui/Pills";
import { Segmented } from "@/components/ui/Segmented";
import {
  IconAlert,
  IconBoard,
  IconBranch,
  IconDownload,
  IconFactory,
  IconFilter,
  IconFolder,
  IconList,
  IconPlus,
} from "@/components/ui/icons";
import { PRDetailDrawer, type PullRequest } from "@/components/Github/PRDetailDrawer";
import { useBoardTasks, moveTaskOptimistic } from "@/hooks/useBoard";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { useBoardStore } from "@/store/boardStore";
import { useViewStore, activeFilterCount, BOARD_VIEWS, type BoardView } from "@/store/viewStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useDoneBurstWatcher } from "@/lib/doneBurst";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import {
  COLUMN_STATUSES,
  applyManualOrder,
  isAgentWorking,
  loadManualOrder,
  saveManualOrder,
  subtaskStats,
  taskCost,
  visibleTasks,
} from "@/lib/boardView";
import type { Task, TaskStatus } from "@/types";

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo:    ["doing"],
  doing:   [],
  ci:      ["review"],
  review:  ["done"],
  done:    [],
  nothing: [],
};

const VIEW_ICON: Record<BoardView, typeof IconBoard> = {
  board: IconBoard,
  list: IconList,
  factory: IconFactory,
};

export function Board() {
  const { loading, error } = useBoardTasks();
  useAgentSocket();
  useDoneBurstWatcher();
  const t = useTranslation();

  const tasks             = useBoardStore((s) => s.tasks);
  const order             = useBoardStore((s) => s.order);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const filterText        = useBoardStore((s) => s.filterText);
  const selectTask        = useBoardStore((s) => s.selectTask);
  const selectedTaskId    = useBoardStore((s) => s.selectedTaskId);
  const selectedPRTaskId  = useBoardStore((s) => s.selectedPRTaskId);
  const selectPRTask      = useBoardStore((s) => s.selectPRTask);
  const upsertTask        = useBoardStore((s) => s.upsertTask);
  const projects          = useBoardStore((s) => s.projects);
  const gitStatus         = useBoardStore((s) =>
    s.selectedProjectId ? s.gitStatusByProject[s.selectedProjectId] : undefined,
  );

  const view       = useViewStore((s) => s.view);
  const setView    = useViewStore((s) => s.setView);
  const filters    = useViewStore((s) => s.filters);
  const clearFilters = useViewStore((s) => s.clearFilters);
  const setFilterText = useBoardStore((s) => s.setFilterText);

  const toast = useToast();

  // Dev-only: lets screenshot scripts fake live agent states in the browser
  // (never reaches core). Stripped from production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __clauflowStore?: typeof useBoardStore }).__clauflowStore = useBoardStore;
  }, []);

  /* ── URL: ?projectId=…&view=… ─────────────────────────────────────────── */
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v && (BOARD_VIEWS as string[]).includes(v)) setView(v as BoardView);
  }, [setView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const before = params.toString();
    if (selectedProjectId != null) params.set("projectId", selectedProjectId);
    if (view === "board") params.delete("view");
    else params.set("view", view);
    const qs = params.toString();
    if (qs === before) return;
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [selectedProjectId, view]);

  /* ── Collapsed columns (localStorage: board-collapsed-cols) ───────────── */
  const [collapsedCols, setCollapsedCols] = useState<Set<TaskStatus>>(() => {
    try {
      const s = localStorage.getItem("board-collapsed-cols");
      return s ? new Set(JSON.parse(s) as TaskStatus[]) : new Set<TaskStatus>(["ci", "nothing"]);
    } catch {
      return new Set<TaskStatus>(["ci", "nothing"]);
    }
  });

  const toggleCol = useCallback((status: TaskStatus) => {
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      try { localStorage.setItem("board-collapsed-cols", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  /* ── Manual in-column order (client-side, per project) ────────────────── */
  const [rank, setRank] = useState<string[]>([]);
  useEffect(() => {
    setRank(selectedProjectId ? loadManualOrder(selectedProjectId) : []);
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const hasRemote       = Boolean(selectedProject?.remote);

  const [activeId, setActiveId]     = useState<string | null>(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [showHelp, setShowHelp]     = useState(false);
  const [pendingMove, setPendingMove] = useState<{ taskId: string; from: TaskStatus; to: TaskStatus } | null>(null);

  useKeyboardShortcuts({
    onNewTask:     useCallback(() => setAddOpen(true), []),
    onEscape:      useCallback(() => {
      if (selectedTaskId) selectTask(null);
      else if (showHelp)  setShowHelp(false);
      else if (addOpen)   setAddOpen(false);
    }, [selectedTaskId, showHelp, addOpen, selectTask]),
    onFocusSearch: useCallback(() => document.getElementById("board-search")?.focus(), []),
    onShowHelp:    useCallback(() => setShowHelp((v) => !v), []),
  });

  /* ── Derived data ─────────────────────────────────────────────────────── */
  const projectTasks = useMemo(
    () => order.map((id) => tasks[id]).filter((x): x is Task => Boolean(x)),
    [tasks, order],
  );
  const visible = useMemo(
    () => visibleTasks(tasks, order, filterText, filters),
    [tasks, order, filterText, filters],
  );

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [], doing: [], ci: [], review: [], done: [], nothing: [],
    };
    for (const x of visible) map[x.status].push(x);
    for (const s of COLUMN_STATUSES) map[s] = applyManualOrder(map[s], rank);
    return map;
  }, [visible, rank]);

  const listRows = useMemo(() => COLUMN_STATUSES.flatMap((s) => byStatus[s]), [byStatus]);
  const subStats = useMemo(() => subtaskStats(tasks), [tasks]);
  const keyById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of projectTasks) m[x.id] = x.displayId ?? `#${x.id.slice(0, 7)}`;
    return m;
  }, [projectTasks]);

  const stats = useMemo(() => {
    let done = 0, running = 0, cost = 0;
    const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, ci: 0, review: 0, done: 0, nothing: 0 };
    for (const x of projectTasks) {
      counts[x.status] += 1;
      if (x.status === "done") done += 1;
      if (isAgentWorking(x)) running += 1;
      cost += taskCost(x) ?? 0;
    }
    return { total: projectTasks.length, done, running, cost, counts };
  }, [projectTasks]);

  const filtering = activeFilterCount(filters) > 0 || filterText.trim().length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeTask = activeId ? tasks[activeId] : null;
  const dragFrom = activeTask?.status ?? null;
  const dropTargetFor = (status: TaskStatus): "allowed" | "confirm" | null => {
    if (!dragFrom || status === dragFrom) return null;
    return ALLOWED_TRANSITIONS[dragFrom].includes(status) ? "allowed" : "confirm";
  };

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
      if ((COLUMN_STATUSES as string[]).includes(maybeCol)) {
        target = maybeCol as TaskStatus;
      }
    }
    if (!target) return;

    // Same column: reorder (client-side only — no API call, no status change).
    if (target === task.status) {
      const col = byStatus[task.status].map((x) => x.id);
      const from = col.indexOf(taskId);
      const to = col.indexOf(String(over.id));
      if (from < 0 || to < 0 || from === to || !selectedProjectId) return;
      const nextCol = arrayMove(col, from, to);
      const nextRank = [...rank.filter((id) => !col.includes(id) && tasks[id]), ...nextCol];
      setRank(nextRank);
      saveManualOrder(selectedProjectId, nextRank);
      return;
    }

    if (!ALLOWED_TRANSITIONS[task.status].includes(target)) {
      setPendingMove({ taskId, from: task.status, to: target });
      return;
    }

    try {
      await moveTaskOptimistic(taskId, target);
      if (target === "doing")  toast.info(t.board.agentStarted);
      if (target === "done")   toast.success(t.board.prMerged);
    } catch (err) {
      toast.error(`${t.board.moveFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="ui-panel ui-panel--raised flex max-w-md flex-col items-center gap-4 px-10 py-10 text-center">
          <span className="ui-panel__icon !h-12 !w-12 !rounded-[12px]" aria-hidden>
            <IconFolder size={22} />
          </span>
          <h1 className="t-h1">{t.board.noProject.title}</h1>
          <p className="text-[14px] leading-relaxed text-ink-2">{t.board.noProject.hint}</p>
        </div>
      </div>
    );
  }

  const ViewIcon = VIEW_ICON[view];

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      {/* ── Page head: title + stats ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <SectionPill size="sm" icon={<ViewIcon size={13} />}>
              {t.shell.viewNames[view]}
            </SectionPill>
            {selectedProject?.slug && (
              <span className="font-mono text-[12px] font-semibold uppercase text-ink-3">
                {selectedProject.slug}
              </span>
            )}
            {gitStatus?.branch && (
              <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-3">
                <IconBranch size={12} />
                {gitStatus.branch}
                <span
                  className="ui-dot !h-2 !w-2 !border"
                  style={{ "--dot": gitStatus.isDirty ? "var(--orange)" : "var(--green)" } as CSSProperties}
                  title={gitStatus.isDirty ? t.shell.dirty : t.shell.clean}
                />
              </span>
            )}
          </div>
          <h1 className="t-display mt-2 truncate text-[32px] text-ink">{selectedProject?.name ?? t.board.title}</h1>
          <p className="mt-1 text-[13px] text-ink-3">{t.board.hint}</p>
        </div>
        <BoardStats total={stats.total} done={stats.done} running={stats.running} cost={stats.cost} />
      </div>

      {/* ── Toolbar: views + quick filters + actions ──────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<BoardView>
          size="sm"
          label={t.board.viewLabel}
          value={view}
          onChange={setView}
          options={BOARD_VIEWS.map((v) => {
            const I = VIEW_ICON[v];
            return { value: v, label: t.shell.viewNames[v], icon: <I size={14} /> };
          })}
        />
        <span aria-hidden className="h-6 w-[2px] rounded bg-hair" />
        <QuickFilters tasks={projectTasks} shown={visible.length} />
        <span className="flex-1" />
        {hasRemote && (
          <Button size="sm" variant="ghost" icon={<IconDownload size={14} />} onClick={() => setImportOpen(true)}>
            {t.board.importIssues}
          </Button>
        )}
        <Tooltip content={t.board.shortcuts.newTask} shortcut="N" side="bottom">
          <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setAddOpen(true)}>
            {t.board.newTask}
          </Button>
        </Tooltip>
      </div>

      <PlannerBanner project={selectedProject} />

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-[10px] border-2 border-line px-3 py-2 text-[13px] font-semibold"
          style={{ background: "var(--red)", color: "var(--on-red)" }}
        >
          <IconAlert size={15} />
          {t.board.loadError}: {error}
        </div>
      )}

      {/* ── Views ─────────────────────────────────────────────────────────── */}
      {filtering && visible.length === 0 && view !== "factory" ? (
        <div className="grid min-h-0 flex-1 place-items-start justify-center pt-10">
          <div className="ui-panel ui-hatch flex max-w-sm flex-col items-center gap-3 px-8 py-8 text-center">
            <span className="ui-panel__icon" aria-hidden>
              <IconFilter size={15} />
            </span>
            <p className="t-h2">{t.board.filters.emptyTitle}</p>
            <p className="text-[13px] text-ink-3">{t.board.filters.emptyHint}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearFilters();
                setFilterText("");
              }}
            >
              {t.board.filters.clear}
            </Button>
          </div>
        </div>
      ) : view === "board" ? (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="-mx-1 flex min-h-0 flex-1 gap-3.5 overflow-x-auto px-1 pb-3">
            {COLUMN_STATUSES.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                title={t.board.columns[status]}
                tasks={byStatus[status]}
                onAddTask={status === "todo" ? () => setAddOpen(true) : undefined}
                collapsed={collapsedCols.has(status)}
                onToggleCollapse={() => toggleCol(status)}
                dropTarget={dropTargetFor(status)}
                subtaskStats={subStats}
                keyById={keyById}
                loading={loading && projectTasks.length === 0}
                planning={status === "todo" && selectedProject?.planningStatus === "planning"}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.3,.7,.4,1)" }}>
            {activeTask ? (
              <TaskCardView
                task={activeTask}
                overlay
                subtasks={subStats[activeTask.id]}
                parentKey={activeTask.parentTaskId ? keyById[activeTask.parentTaskId] : undefined}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : view === "list" ? (
        <TaskList tasks={listRows} subtaskStats={subStats} keyById={keyById} />
      ) : (
        <FactoryView
          tasks={visible}
          epoch={`${selectedProjectId}|${filterText}|${filters.priorities.join(",")}|${filters.tags.join(",")}|${filters.agentRunning}|${filters.prOpen}`}
        />
      )}

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
              toast.success(t.board.prMerged);
            }}
          />
        );
      })()}

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ImportIssuesModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal open={showHelp} onClose={() => setShowHelp(false)} title={t.board.shortcuts.title}>
        <div className="flex flex-col px-5 py-3">
          {[
            { key: "N",   desc: t.board.shortcuts.newTask },
            { key: "/",   desc: t.board.shortcuts.focusSearch },
            { key: "Esc", desc: t.board.shortcuts.close },
            { key: "?",   desc: t.board.shortcuts.openHelp },
          ].map(({ key, desc }) => (
            <div
              key={key}
              className="flex items-center justify-between border-b-[1.5px] border-hair py-3 last:border-b-0"
            >
              <span className="text-[14px] text-ink-2">{desc}</span>
              <Kbd>{key}</Kbd>
            </div>
          ))}
        </div>
      </Modal>

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
            if (to === "done")  toast.success(t.board.prMerged);
          } catch (err) {
            toast.error(`${t.board.moveFailed}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
        onCancel={() => setPendingMove(null)}
      />
    </div>
  );
}
