"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommentsTab } from "@/components/Card/CommentsTab";
import { MiniDagView } from "@/components/Card/MiniDagView";
import { ToolCallTimeline } from "@/components/Card/ToolCallTimeline";
import { api } from "@/lib/api";
import { calculateCost, formatTokens, totalTokens } from "@/lib/cost";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { AgentText, GraphRecord, Task, TaskPatch, ToolCall } from "@/types";

type EditPriority = "low" | "medium" | "high" | "critical";
type DrawerTab = "details" | "log" | "comments" | "flow";

const EMPTY_TOOL_CALLS: ToolCall[] = [];
const EMPTY_AGENT_TEXTS: AgentText[] = [];

const PRIORITY_META: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.15)",   label: "Critical" },
  high:     { color: "#ef4444", bg: "rgba(239,68,68,0.15)",   label: "High"     },
  medium:   { color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  label: "Med"      },
  low:      { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: "Low"      },
};

const STATUS_META: Record<Task["status"], { color: string; label: string }> = {
  todo:   { color: "#6b7280", label: "Todo"   },
  doing:  { color: "#f59e0b", label: "Doing"  },
  ci:     { color: "#3b82f6", label: "CI"     },
  review: { color: "#f97316", label: "Review" },
  done:   { color: "#22c55e", label: "Done"   },
};

interface DraftState {
  title: string;
  description: string;
  analysis: string;
  priority: EditPriority;
  budgetUsd: string;
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
    budgetUsd:   task.budgetUsd != null ? String(task.budgetUsd) : "",
  };
}

const PRIORITY_BUTTONS: EditPriority[] = ["low", "medium", "high", "critical"];

/* ── Mini sub-components ──────────────────────────────────────────────────── */
function PBadge({ priority }: { priority: string }) {
  const m = PRIORITY_META[(priority ?? "").toLowerCase()] ?? PRIORITY_META.low;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
      color: m.color, background: m.bg,
      padding: "1px 6px", borderRadius: 3, textTransform: "uppercase",
    }}>{m.label}</span>
  );
}

function StatusPill({ status }: { status: Task["status"] }) {
  const m = STATUS_META[status] ?? STATUS_META.todo;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
      color: m.color, background: `${m.color}22`,
      padding: "1px 6px", borderRadius: 3, textTransform: "uppercase",
    }}>{m.label}</span>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
      color: "var(--cf-muted)", textTransform: "uppercase",
      marginBottom: 8,
    }}>{label}</div>
  );
}

/* ── Main drawer ──────────────────────────────────────────────────────────── */
export function TaskDetailDrawer() {
  const tt = useTranslation();
  const td = tt.taskDetail;

  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const task           = useBoardStore((s) => s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null);
  const projects       = useBoardStore((s) => s.projects);
  const selectTask     = useBoardStore((s) => s.selectTask);
  const upsertTask     = useBoardStore((s) => s.upsertTask);
  const removeTask     = useBoardStore((s) => s.removeTask);
  const upsertComment  = useBoardStore((s) => s.upsertComment);
  const setToolCalls   = useBoardStore((s) => s.setToolCalls);
  const setAgentTexts  = useBoardStore((s) => s.setAgentTexts);
  const openStudio     = useBoardStore((s) => s.openStudio);
  const upsertNodeRun  = useBoardStore((s) => s.upsertNodeRun);
  const appendNodeLog  = useBoardStore((s) => s.appendNodeLog);

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
  const [graphs,        setGraphs]        = useState<GraphRecord[]>([]);
  const [graphsLoading, setGraphsLoading] = useState(false);
  const [logView,       setLogView]       = useState<"raw" | "timeline">("timeline");

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
    api.getNodeRuns(selectedTaskId).then((runs) => {
      for (const run of runs) {
        upsertNodeRun(run);
        const buffered = run.outputArtifact?.logLines;
        if (Array.isArray(buffered)) {
          for (const line of buffered) appendNodeLog(selectedTaskId, run.nodeId, line as string);
        }
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  useEffect(() => {
    if (!task?.projectId) return;
    setGraphsLoading(true);
    api.listGraphs(task.projectId)
      .then((resp) => setGraphs(resp.graphs))
      .catch(() => {})
      .finally(() => setGraphsLoading(false));
  }, [task?.projectId]);

  const handleExecutionModeChange = async (mode: "simple" | "graph", graphId?: string | null) => {
    if (!task) return;
    const patch: TaskPatch = { executionMode: mode, graphId: mode === "graph" ? (graphId ?? null) : null };
    try {
      const updated = await api.updateTask(task.id, patch);
      upsertTask(updated);
    } catch { /* server is source of truth */ }
  };

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
        title: draft.title.trim(), description: draft.description,
        analysis: draft.analysis, priority: draft.priority,
        budgetUsd: draft.budgetUsd ? parseFloat(draft.budgetUsd) : null,
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
    setRetrying(true); setError(null);
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
    setConfirmAbort(false); setAborting(true); setError(null);
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
    setConfirmDelete(false); setDeleting(true); setError(null);
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

  const toolCalls  = useBoardStore((s) => task ? (s.toolCalls[task.id] ?? EMPTY_TOOL_CALLS) : EMPTY_TOOL_CALLS);
  const agentTexts = useBoardStore((s) => task ? (s.agentTexts[task.id] ?? EMPTY_AGENT_TEXTS) : EMPTY_AGENT_TEXTS);
  const budgetExceeded = useBoardStore((s) => s.budgetExceeded);
  const nodeRunCount   = useBoardStore((s) => task ? Object.keys(s.nodeRuns[task.id] ?? {}).length : 0);

  const costPill = useMemo(() => {
    if (!task?.usage) return null;
    const total = totalTokens(task.usage);
    const cost  = calculateCost(task.usage);
    if (total === 0) return null;
    return { tokens: formatTokens(total), cost: cost.toFixed(4) };
  }, [task?.usage]);

  const budgetInfo = useMemo(() => {
    const exceeded = budgetExceeded[task?.id ?? ""];
    if (!exceeded) return null;
    const pct = Math.min((exceeded.spentUsd / exceeded.budgetUsd) * 100, 100);
    return { spentUsd: exceeded.spentUsd, budgetUsd: exceeded.budgetUsd, pct };
  }, [task?.id, budgetExceeded]);

  if (!open) return null;

  const TABS: { id: DrawerTab; label: string; count?: number }[] = [
    { id: "details",  label: "Details" },
    { id: "log",      label: "Logs",     count: logs.length },
    { id: "comments", label: "Comments", count: commentCount },
    { id: "flow",     label: "DAG",      count: nodeRunCount },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--cf-card)", border: "1px solid var(--cf-border)",
    borderRadius: 6, padding: "7px 10px", fontSize: 13, color: "var(--cf-text)",
    outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  };

  const isActive = (["branching", "running", "pushing", "pr_opening"] as const).includes(
    task?.agent.status as "branching" | "running" | "pushing" | "pr_opening",
  );

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 480, zIndex: 50,
          background: "var(--cf-drawer)", borderLeft: "1px solid var(--cf-border)",
          display: "flex", flexDirection: "column",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
          animation: "cf-slide-in 0.22s ease-out",
          fontFamily: "var(--font-inter, Inter, sans-serif)",
        }}
        role="dialog"
        aria-modal="true"
      >
        {task ? (
          <>
            {/* Header */}
            <header style={{ padding: "16px 20px", borderBottom: "1px solid var(--cf-border)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <PBadge priority={task.priority ?? "low"} />
                <StatusPill status={task.status} />
                {task.prUrl && (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "#818cf8", fontFamily: "monospace", textDecoration: "none" }}
                  >
                    PR #{task.prNumber} ↗
                  </a>
                )}
                {projectName && (
                  <>
                    <button
                      type="button"
                      onClick={() => { if (!task) return; openStudio(task.projectId, task.id); selectTask(null); }}
                      style={{
                        fontSize: 10, color: "#818cf8", background: "rgba(99,102,241,0.1)",
                        border: "1px solid rgba(99,102,241,0.3)", borderRadius: 4,
                        padding: "1px 7px", cursor: "pointer", fontFamily: "monospace",
                      }}
                    >
                      studio →
                    </button>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={close}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--cf-muted)", fontSize: 16, padding: "2px 4px",
                    display: "flex", alignItems: "center",
                  }}
                  aria-label={td.closeLabel}
                >
                  ✕
                </button>
              </div>

              {editing && draft ? (
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }}
                  placeholder={td.titlePlaceholder}
                />
              ) : (
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--cf-text)", margin: 0, lineHeight: 1.4 }}>
                  {task.title}
                </h2>
              )}

              <div style={{ marginTop: 8, fontSize: 11, color: "var(--cf-muted)", fontFamily: "monospace" }}>
                {task.displayId ?? `#${task.id.slice(0, 8)}`}
                {projectName && ` · ${projectName}`}
              </div>
            </header>

            {/* Tabs row */}
            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--cf-border)", flexShrink: 0 }}>
              {TABS.map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  style={{
                    padding: "10px 14px",
                    background: "transparent",
                    border: "none",
                    borderBottom: tab === id ? "2px solid #818cf8" : "2px solid transparent",
                    color: tab === id ? "#818cf8" : "var(--cf-muted)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "color 0.12s",
                    marginBottom: -1,
                  }}
                >
                  {label}{count ? ` (${count})` : ""}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              {costPill && (
                <span style={{ fontSize: 11, color: "var(--cf-muted)", fontFamily: "monospace", paddingRight: 16 }}>
                  ${costPill.cost}
                </span>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto" }} className="cf-scroll">
              {/* ── Details tab ── */}
              {tab === "details" && (
                <div style={{ padding: "16px 20px" }}>
                  {error && (
                    <div style={{
                      marginBottom: 12, padding: "8px 12px", borderRadius: 6,
                      background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                      color: "#ef4444", fontSize: 12,
                    }}>
                      {error}
                    </div>
                  )}

                  {/* Description */}
                  <div style={{ marginBottom: 16 }}>
                    <SectionLabel label={td.descriptionLabel} />
                    {editing && draft ? (
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                        placeholder={td.descriptionPlaceholder}
                      />
                    ) : task.description ? (
                      <p style={{ fontSize: 13, color: "var(--cf-text)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                        {task.description}
                      </p>
                    ) : (
                      <p style={{ fontSize: 12, color: "var(--cf-muted)", fontStyle: "italic", margin: 0 }}>
                        {td.descriptionEmpty}
                      </p>
                    )}
                  </div>

                  {/* Analysis */}
                  <div style={{ marginBottom: 16 }}>
                    <SectionLabel label={td.analysisLabel} />
                    {editing && draft ? (
                      <textarea
                        value={draft.analysis}
                        onChange={(e) => setDraft({ ...draft, analysis: e.target.value })}
                        rows={8}
                        style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}
                        placeholder={td.analysisPlaceholder}
                      />
                    ) : task.analysis ? (
                      <pre style={{
                        fontSize: 12, fontFamily: "monospace", color: "var(--cf-text)",
                        background: "var(--cf-card)", border: "1px solid var(--cf-border)",
                        borderRadius: 6, padding: "10px 12px", overflowX: "auto",
                        whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0, maxHeight: 300,
                        overflowY: "auto",
                      }}>
                        {task.analysis}
                      </pre>
                    ) : (
                      <p style={{ fontSize: 12, color: "var(--cf-muted)", fontStyle: "italic", margin: 0 }}>
                        {td.analysisEmpty}
                      </p>
                    )}
                  </div>

                  {/* Execution Mode */}
                  {!editing && (
                    <div style={{ marginBottom: 16 }}>
                      <SectionLabel label="Execution Mode" />
                      <div style={{ display: "flex", gap: 1, background: "var(--cf-border)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--cf-border)" }}>
                        {(["simple", "graph"] as const).map((mode) => {
                          const isActive = mode === "simple"
                            ? (!task.executionMode || task.executionMode === "simple")
                            : task.executionMode === "graph";
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => void handleExecutionModeChange(mode, mode === "graph" ? (task.graphId ?? graphs[0]?.id ?? null) : null)}
                              style={{
                                flex: 1, padding: "6px 0", border: "none", cursor: "pointer",
                                background: isActive ? "var(--cf-card)" : "transparent",
                                color: isActive ? "var(--cf-text)" : "var(--cf-muted)",
                                fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
                                textTransform: "uppercase",
                              }}
                            >
                              {mode}
                            </button>
                          );
                        })}
                      </div>
                      {task.executionMode === "graph" && (
                        <div style={{ marginTop: 8 }}>
                          {graphsLoading ? (
                            <p style={{ fontSize: 12, color: "var(--cf-muted)", margin: 0 }}>Loading...</p>
                          ) : graphs.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--cf-muted)", margin: 0 }}>No graphs. Create one in Studio.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {graphs.map((g) => {
                                const active = (task.graphId ?? graphs[0]?.id) === g.id;
                                return (
                                  <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => void handleExecutionModeChange("graph", g.id)}
                                    style={{
                                      textAlign: "left", padding: "6px 10px",
                                      background: active ? "rgba(99,102,241,0.1)" : "transparent",
                                      border: `1px solid ${active ? "#6366f1" : "var(--cf-border)"}`,
                                      borderRadius: 5, color: active ? "#818cf8" : "var(--cf-muted)",
                                      fontSize: 12, fontFamily: "monospace", cursor: "pointer",
                                    }}
                                  >
                                    {g.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Priority (edit mode) */}
                  {editing && draft && (
                    <div style={{ marginBottom: 16 }}>
                      <SectionLabel label={td.priorityLabel} />
                      <div style={{ display: "flex", gap: 1, background: "var(--cf-border)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--cf-border)" }}>
                        {PRIORITY_BUTTONS.map((value) => {
                          const m = PRIORITY_META[value];
                          const active = draft.priority === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setDraft({ ...draft, priority: value })}
                              style={{
                                flex: 1, padding: "5px 0", border: "none", cursor: "pointer",
                                background: active ? m.bg : "transparent",
                                color: active ? m.color : "var(--cf-muted)",
                                fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                                textTransform: "uppercase",
                              }}
                            >
                              {tt.addTask.priorities[value]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Retry / Abort */}
                  {task.status === "doing" && (
                    <div style={{ marginBottom: 16 }}>
                      <SectionLabel label="Agent" />
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 8, padding: "10px 12px", borderRadius: 6,
                        background: "var(--cf-card)", border: "1px solid var(--cf-border)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                          {task.agent.status === "idle" ? (
                            <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b7280", display: "inline-block" }} /><span style={{ color: "var(--cf-muted)" }}>Queued</span></>
                          ) : task.agent.status === "error" ? (
                            <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} /><span style={{ color: "#ef4444" }}>Error</span></>
                          ) : (
                            <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} /><span style={{ color: "#f59e0b" }}>{td.agentStatus[task.agent.status as keyof typeof td.agentStatus] ?? task.agent.status}</span></>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {task.agent.status !== "error" && task.agent.status !== "done" && (
                            <button
                              type="button"
                              onClick={() => setConfirmAbort(true)}
                              disabled={aborting}
                              style={{
                                padding: "4px 10px", fontSize: 11, fontFamily: "monospace",
                                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                                borderRadius: 4, color: "#ef4444", cursor: "pointer",
                              }}
                            >
                              {aborting ? td.abortingButton : td.abortButton}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={doRetry}
                            disabled={retrying}
                            style={{
                              padding: "4px 10px", fontSize: 11, fontFamily: "monospace",
                              background: isActive ? "rgba(99,102,241,0.1)" : "transparent",
                              border: `1px solid ${isActive ? "rgba(99,102,241,0.4)" : "var(--cf-border)"}`,
                              borderRadius: 4, color: isActive ? "#818cf8" : "var(--cf-muted)", cursor: "pointer",
                            }}
                          >
                            {retrying ? td.retryingButton : isActive ? td.restartButton : td.retryButton}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Branch / PR */}
                  {(task.branch || task.prUrl) && (
                    <div style={{ marginBottom: 16 }}>
                      <SectionLabel label={td.connectionsLabel} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {task.branch && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--cf-card)", borderRadius: 5, border: "1px solid var(--cf-border)" }}>
                            <span style={{ fontSize: 11, color: "var(--cf-muted)" }}>{td.branchLabel}</span>
                            <code style={{ fontSize: 11, fontFamily: "monospace", color: "#818cf8" }}>{task.branch}</code>
                          </div>
                        )}
                        {task.prUrl && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--cf-card)", borderRadius: 5, border: "1px solid var(--cf-border)" }}>
                            <a href={task.prUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#818cf8", fontFamily: "monospace", textDecoration: "none" }}>
                              {td.openPr} {task.prNumber ? `#${task.prNumber}` : ""} ↗
                            </a>
                            {task.status === "done" && (
                              <span style={{ fontSize: 10, color: "#22c55e", fontFamily: "monospace" }}>● {td.merged}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Budget */}
                  <div style={{ marginBottom: 16 }}>
                    <SectionLabel label="Budget" />
                    {editing && draft ? (
                      <div>
                        <input
                          type="number" min="0" step="0.5"
                          placeholder={`${task.budgetUsd != null ? String(task.budgetUsd) : "2.00 (default)"}`}
                          value={draft.budgetUsd}
                          onChange={(e) => setDraft({ ...draft, budgetUsd: e.target.value })}
                          style={{ ...inputStyle, fontFamily: "monospace" }}
                        />
                        <p style={{ fontSize: 11, color: "var(--cf-muted)", marginTop: 4 }}>
                          Leave blank to inherit project default ($2.00)
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p style={{ fontSize: 12, fontFamily: "monospace", color: "var(--cf-muted)", margin: "0 0 6px" }}>
                          {task.budgetUsd != null ? `$${task.budgetUsd.toFixed(2)} / task` : "Project default"}
                        </p>
                        {budgetInfo && (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--cf-muted)", marginBottom: 4 }}>
                              <span>Spent</span>
                              <span style={{ color: budgetInfo.pct >= 100 ? "#ef4444" : "inherit" }}>
                                ${budgetInfo.spentUsd.toFixed(4)} / ${budgetInfo.budgetUsd.toFixed(2)}
                              </span>
                            </div>
                            <div style={{ height: 4, background: "var(--cf-border)", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{
                                height: "100%",
                                width: `${budgetInfo.pct}%`,
                                background: budgetInfo.pct >= 100 ? "#ef4444" : budgetInfo.pct >= 90 ? "#f59e0b" : "#6366f1",
                                transition: "width 0.3s",
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Log tab ── */}
              {tab === "log" && (
                <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                  {/* Sub-tabs */}
                  <div style={{ display: "flex", gap: 1, padding: "10px 16px 0", flexShrink: 0 }}>
                    {(["timeline", "raw"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setLogView(v)}
                        style={{
                          padding: "4px 12px", fontSize: 10, fontFamily: "monospace",
                          fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                          background: logView === v ? "rgba(99,102,241,0.15)" : "transparent",
                          border: `1px solid ${logView === v ? "rgba(99,102,241,0.4)" : "var(--cf-border)"}`,
                          borderRadius: 4, color: logView === v ? "#818cf8" : "var(--cf-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {v === "timeline" ? `${td.toolTimelineTab}${toolCalls.length > 0 ? ` (${toolCalls.length})` : ""}` : `${td.toolRawTab}${logs.length > 0 ? ` (${logs.length})` : ""}`}
                      </button>
                    ))}
                  </div>

                  <div style={{ flex: 1, overflow: "hidden", padding: "10px 16px 16px" }}>
                    {logView === "timeline" && (
                      task.status === "doing" && task.agent.status === "idle" ? (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--cf-muted)", fontSize: 13 }}>
                          {td.queueWaiting}
                        </div>
                      ) : (
                        <div style={{ height: "100%", overflowY: "auto" }} className="cf-scroll">
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
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--cf-muted)", fontSize: 13 }}>
                          {td.queueWaiting}
                        </div>
                      ) : logs.length > 0 ? (
                        <pre
                          ref={logRef}
                          style={{
                            height: "100%", overflow: "auto", margin: 0,
                            background: "#0a0a0f", borderRadius: 6, padding: "12px 14px",
                            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Courier New', monospace",
                            fontSize: 11.5, color: "#22c55e", lineHeight: 1.7,
                          }}
                          className="cf-scroll"
                        >
                          {logs.join("\n")}
                          <span style={{ animation: "cf-blink 1s step-end infinite", opacity: 0.7 }}>▋</span>
                        </pre>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--cf-muted)", fontSize: 13 }}>
                          {td.logsEmpty}
                        </div>
                      )
                    )}
                  </div>

                  {task.agent.status === "error" && task.agent.error && (
                    <div style={{
                      flexShrink: 0, padding: "10px 14px", margin: "0 16px 16px",
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: 6, fontFamily: "monospace", fontSize: 11.5,
                      color: "#ef4444", lineHeight: 1.5,
                    }}>
                      <span style={{ fontWeight: 700, marginRight: 6 }}>✖ {td.logsErrorPrefix}</span>
                      <span style={{ whiteSpace: "pre-wrap" }}>{task.agent.error}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Comments tab ── */}
              {tab === "comments" && <CommentsTab task={task} />}

              {/* ── Flow/DAG tab ── */}
              {tab === "flow" && (
                <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16 }}>
                  <MiniDagView
                    taskId={task.id}
                    noNodesLabel={td.flowNoNodes}
                    nodeLogsTitle={td.flowNodeLogsTitle}
                    nodeNoLogLabel={td.flowNodeNoLog}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <footer style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 8, padding: "12px 20px",
              borderTop: "1px solid var(--cf-border)", flexShrink: 0,
              background: "var(--cf-surface)",
            }}>
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    style={{
                      padding: "6px 16px", fontSize: 11, fontFamily: "monospace",
                      fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                      background: "transparent", border: "1px solid var(--cf-border)",
                      borderRadius: 5, color: "var(--cf-muted)", cursor: "pointer",
                    }}
                  >
                    {td.cancelButton}
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={saving}
                    style={{
                      padding: "6px 16px", fontSize: 11, fontFamily: "monospace",
                      fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                      background: "#6366f1", border: "1px solid #6366f1",
                      borderRadius: 5, color: "#fff", cursor: "pointer",
                    }}
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
                    style={{
                      padding: "6px 16px", fontSize: 11, fontFamily: "monospace",
                      fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: 5, color: "#ef4444", cursor: "pointer",
                    }}
                  >
                    {deleting ? td.deletingButton : td.deleteButton}
                  </button>
                  <button
                    type="button"
                    onClick={beginEdit}
                    style={{
                      padding: "6px 16px", fontSize: 11, fontFamily: "monospace",
                      fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                      background: "#6366f1", border: "1px solid #6366f1",
                      borderRadius: 5, color: "#fff", cursor: "pointer",
                    }}
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
