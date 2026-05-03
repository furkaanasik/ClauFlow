"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommentsTab } from "@/components/Card/CommentsTab";
import { ToolCallTimeline } from "@/components/Card/ToolCallTimeline";
import { api } from "@/lib/api";
import { calculateCost, formatTokens, totalTokens } from "@/lib/cost";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { AgentText, Task, TaskPatch, ToolCall } from "@/types";

type EditPriority = "low" | "medium" | "high" | "critical";
type DrawerTab = "details" | "log" | "comments";

const EMPTY_TOOL_CALLS: ToolCall[] = [];
const EMPTY_AGENT_TEXTS: AgentText[] = [];

const STATUS_COLOR: Record<Task["status"], string> = {
  todo:   "var(--status-todo)",
  doing:  "var(--status-doing)",
  ci:     "var(--status-ci, var(--status-review))",
  review: "var(--status-review)",
  done:   "var(--status-done)",
};

const PRIO_COLOR: Record<EditPriority, string> = {
  low:      "var(--prio-low)",
  medium:   "var(--prio-medium)",
  high:     "var(--prio-high)",
  critical: "var(--prio-critical)",
};

interface DraftState {
  title: string;
  description: string;
  analysis: string;
  priority: EditPriority;
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

const PRIORITY_BUTTONS: EditPriority[] = ["low", "medium", "high", "critical"];

export function TaskDetailDrawer() {
  const tt = useTranslation();
  const td = tt.taskDetail;
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const task           = useBoardStore((s) =>
    s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null,
  );
  const projects       = useBoardStore((s) => s.projects);
  const selectTask     = useBoardStore((s) => s.selectTask);
  const upsertTask     = useBoardStore((s) => s.upsertTask);
  const removeTask     = useBoardStore((s) => s.removeTask);
  const upsertComment  = useBoardStore((s) => s.upsertComment);
  const setToolCalls   = useBoardStore((s) => s.setToolCalls);
  const setAgentTexts  = useBoardStore((s) => s.setAgentTexts);
  const openStudio     = useBoardStore((s) => s.openStudio);

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
    api.getToolCalls(selectedTaskId).then((calls) => {
      setToolCalls(selectedTaskId, calls);
    }).catch(() => {});
    api.getAgentTexts(selectedTaskId).then((list) => {
      setAgentTexts(selectedTaskId, list);
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

  const toolCalls   = useBoardStore((s) => task ? (s.toolCalls[task.id] ?? EMPTY_TOOL_CALLS) : EMPTY_TOOL_CALLS);
  const agentTexts  = useBoardStore((s) => task ? (s.agentTexts[task.id] ?? EMPTY_AGENT_TEXTS) : EMPTY_AGENT_TEXTS);
  const [logView, setLogView] = useState<"raw" | "timeline">("timeline");

  const costPill = useMemo(() => {
    if (!task?.usage) return null;
    const total = totalTokens(task.usage);
    const cost = calculateCost(task.usage);
    if (total === 0) return null;
    return {
      tokens: formatTokens(total),
      cost: cost.toFixed(2),
    };
  }, [task?.usage]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <aside
          className="relative flex h-[88vh] w-full max-w-[72rem] flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-base)] shadow-2xl"
          role="dialog"
          aria-modal="true"
        >
        {task ? (
          <>
            {/* Header */}
            <header className="border-b border-[var(--border)] px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* Meta row */}
                  <div className="mb-3 flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-[11px] text-[var(--text-faint)]">
                      {task.displayId ?? `#${task.id.slice(0, 8)}`}
                    </span>
                    {projectName && (
                      <>
                        <span className="text-[var(--text-faint)]">·</span>
                        <span className="text-[12px] text-[var(--text-muted)]">
                          {projectName}
                        </span>
                        <span className="text-[var(--text-faint)]">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (!task) return;
                            openStudio(task.projectId, task.id);
                            selectTask(null);
                          }}
                          className="rounded border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300 transition hover:bg-blue-500/20"
                          aria-label="Studio'da aç"
                        >
                          studio →
                        </button>
                      </>
                    )}
                  </div>
                  {/* Title */}
                  {editing && draft ? (
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className="w-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-lg text-[var(--text-primary)] focus:border-[var(--text-secondary)] focus:outline-none"
                      placeholder={td.titlePlaceholder}
                    />
                  ) : (
                    <h2 className="t-display text-3xl leading-[1.1] text-[var(--text-primary)]">
                      {task.title}
                    </h2>
                  )}

                  {/* Status + Priority pills */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill ink={STATUS_COLOR[task.status]} label={task.status} />
                    {task.priority && !editing && (
                      <Pill
                        ink={PRIO_COLOR[normalizePriority(task.priority)]}
                        label={task.priority}
                      />
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="shrink-0 border border-[var(--border)] p-2 text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  aria-label={td.closeLabel}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 1l12 12M13 1L1 13" />
                  </svg>
                </button>
              </div>
            </header>

            {/* Tabs */}
            <div className="flex border-b border-[var(--border)]">
              {([
                { id: "details" as const,  label: td.tabDetails,  count: 0 },
                { id: "log" as const,      label: td.tabLog,      count: logs.length },
                { id: "comments" as const, label: td.tabComments, count: commentCount },
              ]).map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={clsx(
                    "relative flex flex-1 items-center justify-center gap-2 px-4 py-3 text-[13px] font-medium transition",
                    tab === id
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                  )}
                >
                  <span>{label}</span>
                  {count > 0 && (
                    <span className="font-mono text-[11px] text-[var(--text-faint)]">
                      ({count})
                    </span>
                  )}
                  {tab === id && (
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-[var(--accent-primary)]" />
                  )}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {tab === "comments" ? (
                <CommentsTab task={task} />
              ) : tab === "details" ? (
                <div className="px-6 py-5">
                  {error && (
                    <div className="mb-4 border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-sm text-[var(--status-error)]">
                      {error}
                    </div>
                  )}

                  {/* Description */}
                  <Section label={td.descriptionLabel} numeral="01">
                    {editing && draft ? (
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        rows={3}
                        className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--text-secondary)] focus:outline-none"
                        placeholder={td.descriptionPlaceholder}
                      />
                    ) : task.description ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
                        {task.description}
                      </p>
                    ) : (
                      <p className="t-quote text-sm text-[var(--text-faint)]">{td.descriptionEmpty}</p>
                    )}
                  </Section>

                  {/* Analysis */}
                  <Section label={td.analysisLabel} numeral="02">
                    {editing && draft ? (
                      <textarea
                        value={draft.analysis}
                        onChange={(e) => setDraft({ ...draft, analysis: e.target.value })}
                        rows={8}
                        className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)] focus:border-[var(--text-secondary)] focus:outline-none"
                        placeholder={td.analysisPlaceholder}
                      />
                    ) : task.analysis ? (
                      <pre className="analysis-block max-h-80 overflow-auto whitespace-pre-wrap border p-3.5">
                        {task.analysis}
                      </pre>
                    ) : (
                      <p className="t-quote text-sm text-[var(--text-faint)]">{td.analysisEmpty}</p>
                    )}
                  </Section>

                  {/* Priority (edit mode) */}
                  {editing && draft && (
                    <Section label={td.priorityLabel} numeral="03">
                      <div className="flex gap-px border border-[var(--border)] bg-[var(--border)]">
                        {PRIORITY_BUTTONS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDraft({ ...draft, priority: value })}
                            className={clsx(
                              "flex-1 px-3 py-2 font-mono text-[11px] uppercase tracking-widest transition",
                              draft.priority === value
                                ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                                : "bg-[var(--bg-base)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                            )}
                            style={
                              draft.priority === value
                                ? { boxShadow: `inset 0 -2px 0 ${PRIO_COLOR[value]}` }
                                : {}
                            }
                          >
                            {tt.addTask.priorities[value]}
                          </button>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Retry / Abort panel */}
                  {task.status === "doing" && (
                    <Section label={td.connectionsLabel} numeral="04">
                      <div className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
                        <div className="flex items-center gap-2 text-sm">
                          {task.agent.status === "idle" ? (
                            <>
                              <span className="h-1.5 w-1.5 bg-[var(--text-faint)]" />
                              <span className="text-[var(--text-muted)]">{td.queueWaiting}</span>
                            </>
                          ) : task.agent.status === "error" ? (
                            <>
                              <span className="h-1.5 w-1.5 bg-[var(--status-error)]" />
                              <span className="text-[var(--status-error)]">{td.errorOccurred}</span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 animate-pulse bg-[var(--status-doing)]" />
                              <span className="text-[var(--status-doing)]">
                                {td.agentStatus[task.agent.status as keyof typeof td.agentStatus] ?? task.agent.status}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {task.agent.status !== "error" && task.agent.status !== "done" && (
                            <button
                              type="button"
                              onClick={() => setConfirmAbort(true)}
                              disabled={aborting}
                              className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--status-error)] transition hover:bg-[var(--status-error)] hover:text-[var(--bg-base)] disabled:opacity-50"
                            >
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
                                className={clsx(
                                  "border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition disabled:opacity-50",
                                  isActive
                                    ? "border-[var(--accent-primary)] bg-[var(--accent-muted)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-[var(--accent-ink)]"
                                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
                                )}
                              >
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
                    </Section>
                  )}

                  {/* Branch / PR */}
                  {(task.branch || task.prUrl) && (
                    <Section label={td.connectionsLabel} numeral="05">
                      <div className="flex flex-col gap-2.5">
                        {task.branch && (
                          <div className="flex items-center gap-3 border-b border-[var(--border)] pb-2.5">
                            <span className="t-label">{td.branchLabel}</span>
                            <code className="font-mono text-xs text-[var(--accent-primary)]">
                              {task.branch}
                            </code>
                          </div>
                        )}
                        {task.prUrl && (
                          <div className="flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
                            <a
                              href={task.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-sm font-medium text-[var(--accent-primary)] transition hover:opacity-80"
                            >
                              {td.openPr} {task.prNumber ? `#${task.prNumber}` : ""} ↗
                            </a>
                            {task.status === "done" && (
                              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent-primary)]">
                                ● {td.merged}
                              </span>
                            )}
                            {task.agent.status === "error" && task.status !== "done" && (
                              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--status-error)]">
                                ● {td.mergeError}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </Section>
                  )}
                </div>
              ) : (
                /* Log tab */
                <div className="flex h-full flex-col gap-3 p-4">
                  {/* View toggle */}
                  <div className="inline-flex self-start border border-[var(--border)] bg-[var(--bg-surface)]">
                    <button
                      type="button"
                      onClick={() => setLogView("timeline")}
                      className={clsx(
                        "border-r border-[var(--border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition",
                        logView === "timeline"
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      {td.toolTimelineTab}{toolCalls.length > 0 && ` (${toolCalls.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogView("raw")}
                      className={clsx(
                        "px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition",
                        logView === "raw"
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      {td.toolRawTab}{logs.length > 0 && ` (${logs.length})`}
                    </button>
                  </div>

                  {logView === "timeline" && (
                    task.status === "doing" && task.agent.status === "idle" ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)]">
                        <span className="flex gap-1">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="h-1.5 w-1.5 animate-pulse bg-[var(--text-faint)]"
                              style={{ animationDelay: `${i * 200}ms` }}
                            />
                          ))}
                        </span>
                        <span className="t-quote text-base">{td.queueWaiting}</span>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto">
                        <ToolCallTimeline
                          toolCalls={toolCalls}
                          agentTexts={agentTexts}
                          compact
                          emptyMessage={td.toolTimelineEmpty}
                          isAgentRunning={task?.status === "doing"}
                          thinkingMessage={td.toolThinking}
                        />
                      </div>
                    )
                  )}

                  {logView === "raw" && (
                    task.status === "doing" && task.agent.status === "idle" ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)]">
                        <span className="flex gap-1">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="h-1.5 w-1.5 animate-pulse bg-[var(--text-faint)]"
                              style={{ animationDelay: `${i * 200}ms` }}
                            />
                          ))}
                        </span>
                        <span className="t-quote text-base">{td.queueWaiting}</span>
                      </div>
                    ) : logs.length > 0 ? (
                      <pre
                        ref={logRef}
                        className="flex-1 overflow-auto border border-[var(--border)] bg-[var(--bg-sunken)] p-4 font-mono text-[12px] leading-relaxed text-[var(--accent-primary)]"
                      >
                        {logs.join("\n")}
                      </pre>
                    ) : (
                      <div className="flex flex-1 items-center justify-center border border-dashed border-[var(--border)] text-sm text-[var(--text-faint)]">
                        {td.logsEmpty}
                      </div>
                    )
                  )}

                  {task.agent.status === "error" && task.agent.error && (
                    <div className="shrink-0 border border-[var(--status-error)] bg-[var(--status-error-ink)] px-4 py-3 font-mono text-[12px] leading-relaxed text-[var(--status-error)]">
                      <span className="mr-2 font-bold">✖ {td.logsErrorPrefix}</span>
                      <span className="whitespace-pre-wrap">{task.agent.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="btn-ghost px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                  >
                    {td.cancelButton}
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={saving}
                    className="btn-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
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
                    className="border border-[var(--status-error)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)] disabled:opacity-50"
                  >
                    {deleting ? td.deletingButton : td.deleteButton}
                  </button>

                  {costPill && (
                    <span
                      className="border border-[var(--border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]"
                      title="Approximate cost"
                    >
                      {costPill.tokens} {td.costTokens} · ~${costPill.cost}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={beginEdit}
                    className="btn-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em]"
                  >
                    {td.editButton}
                  </button>
                </>
              )}
            </footer>
          </>
        ) : null}
      </aside>
      </div>

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

function Section({
  label,
  children,
}: {
  label: string;
  numeral?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <header className="mb-2.5">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {label}
        </span>
      </header>
      {children}
    </section>
  );
}

function Pill({ ink, label }: { ink: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium capitalize"
      style={{ borderColor: ink, color: ink }}
    >
      <span className="h-1 w-1" style={{ background: ink }} />
      {label}
    </span>
  );
}
