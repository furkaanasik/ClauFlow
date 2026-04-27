"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommentsTab } from "@/components/Card/CommentsTab";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task, TaskPatch } from "@/types";

type EditPriority = "low" | "medium" | "high" | "critical";
type DrawerTab = "details" | "log" | "comments";

interface DraftState {
  title: string;
  description: string;
  analysis: string;
  priority: EditPriority;
}

function priorityTone(priority?: string | null): BadgeTone {
  switch ((priority ?? "").toLowerCase()) {
    case "critical":
    case "high":   return "red";
    case "medium": return "yellow";
    case "low":    return "green";
    default:       return "neutral";
  }
}

function statusTone(status: Task["status"]): BadgeTone {
  switch (status) {
    case "doing":  return "yellow";
    case "review": return "purple";
    case "done":   return "green";
    default:       return "neutral";
  }
}

function normalizePriority(p?: string | null): EditPriority {
  const v = (p ?? "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return "medium";
}

function makeDraft(task: Task): DraftState {
  return {
    title:       task.title,
    description: task.description ?? "",
    analysis:    task.analysis ?? "",
    priority:    normalizePriority(task.priority),
  };
}

const PRIORITY_BUTTONS: { value: EditPriority; color: string }[] = [
  { value: "low",      color: "text-emerald-400 border-emerald-700 bg-emerald-950/40" },
  { value: "medium",   color: "text-yellow-400  border-yellow-700  bg-yellow-950/40"  },
  { value: "high",     color: "text-orange-400  border-orange-700  bg-orange-950/40"  },
  { value: "critical", color: "text-red-400     border-red-700     bg-red-950/40"     },
];

export function TaskDetailDrawer() {
  const tt = useTranslation();
  const td = tt.taskDetail;
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const task           = useBoardStore((s) =>
    s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null,
  );
  const projects    = useBoardStore((s) => s.projects);
  const selectTask    = useBoardStore((s) => s.selectTask);
  const upsertTask    = useBoardStore((s) => s.upsertTask);
  const removeTask    = useBoardStore((s) => s.removeTask);
  const upsertComment = useBoardStore((s) => s.upsertComment);

  const [editing,       setEditing]       = useState(false);
  const [draft,         setDraft]         = useState<DraftState | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [retrying,      setRetrying]      = useState(false);
  const [aborting,      setAborting]      = useState(false);
  const [confirmAbort,  setConfirmAbort]  = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [tab,           setTab]           = useState<DrawerTab>("details");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = Boolean(selectedTaskId);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setError(null);
    setSaving(false);
    setDeleting(false);
    setTab("details");
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    api.getComments(selectedTaskId).then((comments) => {
      comments.forEach((c) => upsertComment(c));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  const close = () => selectTask(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [task?.agent.log?.length]);

  const beginEdit  = () => { if (!task) return; setDraft(makeDraft(task)); setEditing(true); setError(null); };
  const cancelEdit = () => { setEditing(false); setDraft(null); setError(null); };

  const saveEdit = async () => {
    if (!task || !draft) return;
    if (!draft.title.trim()) { setError(td.errors.titleRequired); return; }
    setSaving(true);
    setError(null);
    try {
      const patch: TaskPatch = {
        title:       draft.title.trim(),
        description: draft.description,
        analysis:    draft.analysis,
        priority:    draft.priority,
      };
      const updated = await api.updateTask(task.id, patch);
      upsertTask(updated);
      setEditing(false);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : td.errors.updateFailed);
    } finally {
      setSaving(false);
    }
  };

  const doRetry = async () => {
    if (!task) return;
    setRetrying(true);
    setError(null);
    try {
      const updated = await api.retryTask(task.id);
      upsertTask(updated);
      setTab("log");
    } catch (err) {
      setError(err instanceof Error ? err.message : td.errors.retryFailed);
    } finally {
      setRetrying(false);
    }
  };

  const doAbort = async () => {
    if (!task) return;
    setConfirmAbort(false);
    setAborting(true);
    setError(null);
    try {
      await api.abortTask(task.id);
      // WS will broadcast the rolled-back task; nothing else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abort failed");
    } finally {
      setAborting(false);
    }
  };

  const doDelete = async () => {
    if (!task) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTask(task.id);
      removeTask(task.id);
      selectTask(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : td.errors.deleteFailed);
      setDeleting(false);
    }
  };

  const logs         = useMemo(() => task?.agent.log ?? [], [task?.agent.log]);
  const commentCount = task?.comments?.length ?? 0;
  const projectName  = task ? (projects.find((p) => p.id === task.projectId)?.name ?? "") : "";

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={clsx(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l shadow-2xl",
          "transform transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        {task ? (
          <>
            {/* Header */}
            <header className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                {/* Meta bilgiler */}
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                  {task.priority && !editing && (
                    <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
                  )}
                  {projectName && (
                    <span className="text-[10px] text-zinc-600">{projectName}</span>
                  )}
                  {task.displayId ? (
                    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-400">
                      {task.displayId}
                    </code>
                  ) : (
                    <span className="font-mono text-[10px] text-zinc-700">#{task.id.slice(0, 8)}</span>
                  )}
                </div>
                {/* Baslik */}
                {editing && draft ? (
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-sm font-semibold placeholder-zinc-600 focus:outline-none"
                    style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                    placeholder={td.titlePlaceholder}
                  />
                ) : (
                  <h2 className="text-sm font-semibold leading-tight text-zinc-100">
                    {task.title}
                  </h2>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-md p-1 transition"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
                aria-label={td.closeLabel}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </header>

            {/* Sekmeler */}
            <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
              <button
                type="button"
                onClick={() => setTab("details")}
                className={clsx(
                  "px-3 py-2 text-xs font-medium transition",
                  tab === "details"
                    ? "border-b-2 border-[var(--accent-primary)] text-[var(--accent-primary)]"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {td.tabDetails}
              </button>
              <button
                type="button"
                onClick={() => setTab("log")}
                className={clsx(
                  "px-3 py-2 text-xs font-medium transition",
                  tab === "log"
                    ? "border-b-2 border-[var(--accent-primary)] text-[var(--accent-primary)]"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {`${td.tabLog}${logs.length > 0 ? ` (${logs.length})` : ""}`}
              </button>
              <button
                type="button"
                onClick={() => setTab("comments")}
                className={clsx(
                  "px-3 py-2 text-xs font-medium transition",
                  tab === "comments"
                    ? "border-b-2 border-[var(--accent-primary)] text-[var(--accent-primary)]"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {commentCount > 0 ? `${td.tabComments} (${commentCount})` : td.tabComments}
              </button>
            </div>

            {/* Icerik */}
            <div className="flex-1 overflow-y-auto">
              {tab === "comments" ? (
                <CommentsTab task={task} />
              ) : tab === "details" ? (
                <div className="px-4 py-3">
                  {error && (
                    <div className="mb-3 rounded-lg border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
                      {error}
                    </div>
                  )}

                  {/* Aciklama */}
                  <section className="mb-5">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                      {td.descriptionLabel}
                    </h3>
                    {editing && draft ? (
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        rows={3}
                        className="w-full resize-y rounded-lg border px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                        placeholder={td.descriptionPlaceholder}
                      />
                    ) : task.description ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                        {task.description}
                      </p>
                    ) : (
                      <p className="text-xs italic text-zinc-700">{td.descriptionEmpty}</p>
                    )}
                  </section>

                  {/* Analiz */}
                  <section className="mb-5">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                      {td.analysisLabel}
                    </h3>
                    {editing && draft ? (
                      <textarea
                        value={draft.analysis}
                        onChange={(e) => setDraft({ ...draft, analysis: e.target.value })}
                        rows={8}
                        className="w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs placeholder-zinc-600 focus:outline-none"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                        placeholder={td.analysisPlaceholder}
                      />
                    ) : task.analysis ? (
                      <pre className="analysis-block max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs leading-relaxed text-zinc-200">
                        {task.analysis}
                      </pre>
                    ) : (
                      <p className="text-xs italic text-zinc-700">{td.analysisEmpty}</p>
                    )}
                  </section>

                  {/* Oncelik (edit modunda) */}
                  {editing && draft && (
                    <section className="mb-5">
                      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                        {td.priorityLabel}
                      </h3>
                      <div className="flex gap-2">
                        {PRIORITY_BUTTONS.map(({ value, color }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDraft({ ...draft, priority: value })}
                            className={clsx(
                              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                              color,
                              draft.priority === value
                                ? "ring-2 ring-offset-1 ring-offset-zinc-900 ring-current"
                                : "opacity-50 hover:opacity-80",
                            )}
                          >
                            {tt.addTask.priorities[value]}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Retry — doing + takili kalmis */}
                  {task.status === "doing" && (
                    <section className="mb-5">
                      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          {task.agent.status === "idle" ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                              <span>{td.queueWaiting}</span>
                            </>
                          ) : task.agent.status === "error" ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              <span className="text-red-400">{td.errorOccurred}</span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
                              <span className="text-yellow-300">
                                {td.agentStatus[task.agent.status as keyof typeof td.agentStatus] ?? task.agent.status}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {task.agent.status !== "error" && task.agent.status !== "done" && (
                            <button
                              type="button"
                              onClick={() => setConfirmAbort(true)}
                              disabled={aborting}
                              className="flex items-center gap-1.5 rounded-md border border-red-900/60 bg-red-950/30 px-2.5 py-1 text-[11px] font-medium text-red-300 transition hover:border-red-700 hover:bg-red-900/40 hover:text-red-200 disabled:opacity-50"
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                <rect x="3" y="3" width="10" height="10" rx="1.5" />
                              </svg>
                              {aborting ? td.abortingButton : td.abortButton}
                            </button>
                          )}
                          {(() => {
                            const isActive = (
                              ["branching", "running", "pushing", "pr_opening"] as const
                            ).includes(
                              task.agent.status as
                                | "branching"
                                | "running"
                                | "pushing"
                                | "pr_opening",
                            );
                            return (
                              <button
                                type="button"
                                onClick={doRetry}
                                disabled={retrying}
                                className={
                                  isActive
                                    ? "flex items-center gap-1.5 rounded-md border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--accent-primary)] transition hover:border-[var(--accent-primary)]/60 hover:bg-[var(--accent-primary)]/20 disabled:opacity-50"
                                    : "flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
                                }
                                title={
                                  isActive
                                    ? "Çalışan claude oturumunu kapatıp yeni bir oturum açar"
                                    : undefined
                                }
                              >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                  <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                                </svg>
                                {retrying
                                  ? td.retryingButton
                                  : isActive
                                    ? td.restartButton
                                    : td.retryButton}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Branch / PR */}
                  {(task.branch || task.prUrl) && (
                    <section className="mb-5 flex flex-col gap-3">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                        {td.connectionsLabel}
                      </h3>
                      {task.branch && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-zinc-600">{td.branchLabel}</span>
                          <code className="rounded-md bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-blue-300">
                            {task.branch}
                          </code>
                        </div>
                      )}
                      {task.prUrl && (
                        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                          <div className="flex flex-1 items-center gap-2">
                            <a
                              href={task.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium transition" style={{ color: "var(--accent-primary)" }}
                            >
                              {td.openPr} {task.prNumber ? `#${task.prNumber}` : ""} ↗
                            </a>
                          </div>
                          {task.status === "done" && (
                            <span className="flex items-center gap-1 rounded-full bg-[var(--accent-primary)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-primary)]">
                              {td.merged}
                            </span>
                          )}
                          {task.agent.status === "error" && task.status !== "done" && (
                            <span className="rounded-full bg-red-900/50 px-2.5 py-1 text-[11px] font-semibold text-red-300">
                              {td.mergeError}
                            </span>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              ) : (
                /* Agent Logu sekmesi */
                <div className="flex h-full flex-col gap-2 p-2.5">
                  {task.status === "doing" && task.agent.status === "idle" ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-500">
                      <span className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-pulse"
                            style={{ animationDelay: `${i * 200}ms` }}
                          />
                        ))}
                      </span>
                      <span>{td.queueWaiting}</span>
                    </div>
                  ) : logs.length > 0 ? (
                    <pre
                      ref={logRef}
                      className="flex-1 overflow-auto rounded-xl border border-zinc-800 bg-black p-3 font-mono text-[11px] leading-relaxed text-emerald-400"
                    >
                      {logs.join("\n")}
                    </pre>
                  ) : (
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-700">
                      {td.logsEmpty}
                    </div>
                  )}
                  {task.agent.status === "error" && task.agent.error && (
                    <div className="shrink-0 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-red-400">
                      <span className="mr-2 font-bold">✖ {td.logsErrorPrefix}</span>
                      <span className="whitespace-pre-wrap">{task.agent.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-1.5 border-t px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition"
                  >
                    {td.cancelButton}
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={saving}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 transition"
                    style={{ background: "var(--accent-primary)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-primary)"; }}
                  >
                    {saving ? td.savingButton : td.saveButton}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={deleting}
                    className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/40 disabled:opacity-50 transition"
                  >
                    {deleting ? td.deletingButton : td.deleteButton}
                  </button>
                  <button
                    type="button"
                    onClick={beginEdit}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition"
                    style={{ background: "var(--accent-primary)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-primary)"; }}
                  >
                    {td.editButton}
                  </button>
                </>
              )}
            </footer>
          </>
        ) : null}
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title={td.confirmDelete.title}
        description={td.confirmDelete.description}
        confirmLabel={td.confirmDelete.confirm}
        cancelLabel={td.confirmDelete.cancel}
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmAbort}
        title={td.confirmAbort.title}
        description={td.confirmAbort.description}
        confirmLabel={td.confirmAbort.confirm}
        cancelLabel={td.confirmDelete.cancel}
        variant="danger"
        onConfirm={doAbort}
        onCancel={() => setConfirmAbort(false)}
      />
    </>
  );
}
