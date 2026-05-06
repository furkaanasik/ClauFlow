"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import type { GraphRecord } from "@/types";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
}

type Priority = "low" | "medium" | "high" | "critical";

const PRIO_META: Record<Priority, { color: string; bg: string }> = {
  low:      { color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  medium:   { color: "#f59e0b", bg: "rgba(245,158,11,0.15)"  },
  high:     { color: "#ef4444", bg: "rgba(239,68,68,0.15)"   },
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.15)"   },
};

const PRIO_LIST: Priority[] = ["low", "medium", "high", "critical"];

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--cf-card)", border: "1px solid var(--cf-border)",
  borderRadius: 6, padding: "7px 10px", fontSize: 13, color: "var(--cf-text)",
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

export function AddTaskModal({ open, onClose }: AddTaskModalProps) {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const upsertTask        = useBoardStore((s) => s.upsertTask);
  const toast             = useToast();
  const t                 = useTranslation();

  const [title,         setTitle]         = useState("");
  const [description,   setDescription]   = useState("");
  const [analysis,      setAnalysis]      = useState("");
  const [priority,      setPriority]      = useState<Priority>("medium");
  const [budgetUsd,     setBudgetUsd]     = useState<string>("");
  const [executionMode, setExecutionMode] = useState<"simple" | "graph">("simple");
  const [graphId,       setGraphId]       = useState<string | null>(null);
  const [graphs,        setGraphs]        = useState<GraphRecord[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    if (!open || !selectedProjectId) return;
    api.listGraphs(selectedProjectId)
      .then((r) => { setGraphs(r.graphs); setGraphId(r.graphs[0]?.id ?? null); })
      .catch(() => {});
  }, [open, selectedProjectId]);

  const reset = () => {
    setTitle(""); setDescription(""); setAnalysis(""); setPriority("medium");
    setBudgetUsd(""); setExecutionMode("simple"); setGraphId(null); setError(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) { setError(t.addTask.errorNoProject); return; }
    if (!title.trim())       { setError(t.addTask.errorNoTitle);    return; }
    setLoading(true); setError(null);
    try {
      const parsedBudget = budgetUsd.trim() ? parseFloat(budgetUsd) : undefined;
      const task = await api.createTask({
        projectId: selectedProjectId,
        title: title.trim(),
        description: description.trim() || undefined,
        analysis: analysis.trim() || undefined,
        priority,
        budgetUsd: parsedBudget && !isNaN(parsedBudget) ? parsedBudget : null,
        executionMode,
        graphId: executionMode === "graph" ? graphId : null,
      });
      upsertTask(task);
      toast.success(t.addTask.successToast);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.addTask.errorGeneric);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={t.addTask.modalTitle} size="lg">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t.addTask.titleLabel} <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.addTask.titlePlaceholder}
            style={inputStyle}
            autoFocus
          />
        </div>

        {/* Priority */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t.addTask.priorityLabel}
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            {PRIO_LIST.map((value) => {
              const m = PRIO_META[value];
              const active = priority === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriority(value)}
                  style={{
                    flex: 1, padding: "6px 4px", borderRadius: 5,
                    background: active ? m.bg : "transparent",
                    border: `1px solid ${active ? m.color : "var(--cf-border)"}`,
                    color: active ? m.color : "var(--cf-muted)",
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                    textTransform: "uppercase", cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {t.addTask.priorities[value]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Execution mode */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Execution Mode
          </label>
          <div style={{ display: "flex", gap: 1, background: "var(--cf-border)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--cf-border)" }}>
            {(["simple", "graph"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setExecutionMode(mode)}
                style={{
                  flex: 1, padding: "7px 0", border: "none", cursor: "pointer",
                  background: executionMode === mode ? "var(--cf-card)" : "transparent",
                  color: executionMode === mode ? "var(--cf-text)" : "var(--cf-muted)",
                  fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Graph picker */}
        {executionMode === "graph" && graphs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Graph
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {graphs.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGraphId(g.id)}
                  style={{
                    textAlign: "left", padding: "7px 10px",
                    background: graphId === g.id ? "rgba(99,102,241,0.1)" : "transparent",
                    border: `1px solid ${graphId === g.id ? "#6366f1" : "var(--cf-border)"}`,
                    borderRadius: 5, color: graphId === g.id ? "#818cf8" : "var(--cf-muted)",
                    fontSize: 12, fontFamily: "monospace", cursor: "pointer",
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t.addTask.descriptionLabel}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.addTask.descriptionPlaceholder}
            rows={2}
            style={{ ...inputStyle, resize: "none", lineHeight: 1.5 }}
          />
        </div>

        {/* Analysis */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t.addTask.analysisLabel}
            </label>
            <span style={{ fontSize: 11, color: "var(--cf-muted)", fontStyle: "italic" }}>{t.addTask.analysisHint}</span>
          </div>
          <textarea
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
            placeholder={t.addTask.analysisPlaceholder}
            rows={6}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}
          />
        </div>

        {/* Budget */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Budget (USD)
            </label>
            <span style={{ fontSize: 11, color: "var(--cf-muted)", fontStyle: "italic" }}>optional</span>
          </div>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={budgetUsd}
            onChange={(e) => setBudgetUsd(e.target.value)}
            placeholder="e.g. 2.00"
            style={{ ...inputStyle, fontFamily: "monospace" }}
          />
        </div>

        {error && (
          <div style={{
            padding: "8px 12px", borderRadius: 5,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444", fontSize: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 4, borderTop: "1px solid var(--cf-border)" }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: "7px 18px", fontSize: 12, fontWeight: 500,
              background: "transparent", border: "1px solid var(--cf-border)",
              borderRadius: 6, color: "var(--cf-muted)", cursor: "pointer",
            }}
          >
            {t.addTask.cancel}
          </button>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "7px 20px", fontSize: 12, fontWeight: 600,
              background: loading ? "rgba(99,102,241,0.5)" : "#6366f1",
              border: "1px solid transparent",
              borderRadius: 6, color: "#fff", cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {loading ? t.addTask.submitting : t.addTask.submit}
            {!loading && <span aria-hidden>→</span>}
          </button>
        </div>
      </form>
    </Modal>
  );
}
