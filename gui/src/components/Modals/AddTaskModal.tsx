"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { api, githubApi } from "@/lib/api";
import type { GraphRecord } from "@/types";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
}

type Priority = "low" | "medium" | "high" | "critical";

const PRIO_COLOR: Record<Priority, string> = {
  low:      "var(--prio-low)",
  medium:   "var(--prio-medium)",
  high:     "var(--prio-high)",
  critical: "var(--prio-critical)",
};

const PRIO_LIST: Priority[] = ["low", "medium", "high", "critical"];

export function AddTaskModal({ open, onClose }: AddTaskModalProps) {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const projects          = useBoardStore((s) => s.projects);
  const upsertTask        = useBoardStore((s) => s.upsertTask);
  const toast             = useToast();
  const t                 = useTranslation();

  const openProjectDetail = useBoardStore((s) => s.openProjectDetail);
  const selectedProject   = projects.find((p) => p.id === selectedProjectId);
  const hasRemote         = Boolean(selectedProject?.remote);

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
  const [createGhIssue, setCreateGhIssue] = useState(false);

  useEffect(() => {
    if (!open || !selectedProjectId) return;
    api.listGraphs(selectedProjectId)
      .then((r) => {
        setGraphs(r.graphs);
        setGraphId(r.graphs[0]?.id ?? null);
      })
      .catch(() => {});
  }, [open, selectedProjectId]);

  const reset = () => {
    setTitle(""); setDescription(""); setAnalysis(""); setPriority("medium");
    setBudgetUsd(""); setExecutionMode("simple"); setGraphId(null); setError(null);
    setCreateGhIssue(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) { setError(t.addTask.errorNoProject); return; }
    if (!title.trim())       { setError(t.addTask.errorNoTitle);    return; }
    setLoading(true);
    setError(null);
    try {
      const parsedBudget = budgetUsd.trim() ? parseFloat(budgetUsd) : undefined;
      const task = await api.createTask({
        projectId: selectedProjectId,
        title:       title.trim(),
        description: description.trim() || undefined,
        analysis:    analysis.trim()    || undefined,
        priority,
        budgetUsd:     parsedBudget && !isNaN(parsedBudget) ? parsedBudget : null,
        executionMode,
        graphId: executionMode === "graph" ? graphId : null,
      });
      upsertTask(task);
      if (createGhIssue && selectedProjectId) {
        githubApi.createIssue(selectedProjectId, title.trim(), description.trim()).catch(() => {
          // fire-and-forget — task creation already succeeded, don't fail for this
        });
      }
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label={t.addTask.titleLabel} required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.addTask.titlePlaceholder}
            className={inputCls}
            autoFocus
          />
        </Field>

        <Field label={t.addTask.priorityLabel}>
          <div className="flex gap-px border border-[var(--border)] bg-[var(--border)]">
            {PRIO_LIST.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPriority(value)}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-[12px] font-medium capitalize transition",
                  priority === value
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                )}
                style={priority === value ? { boxShadow: `inset 0 -2px 0 ${PRIO_COLOR[value]}` } : {}}
              >
                <span className="h-1.5 w-1.5" style={{ background: PRIO_COLOR[value] }} />
                {t.addTask.priorities[value]}
              </button>
            ))}
          </div>
        </Field>

        {/* Execution mode */}
        <Field label="Execution mode">
          <div className="flex gap-px border border-[var(--border)] bg-[var(--border)]">
            {(["simple", "graph"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setExecutionMode(mode)}
                className={clsx(
                  "flex flex-1 items-center justify-center px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest transition",
                  executionMode === mode
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </Field>

        {/* Graph picker — only when graph mode */}
        {executionMode === "graph" && graphs.length > 0 && (
          <Field label="Graph">
            <div className="flex flex-col gap-1">
              {graphs.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGraphId(g.id)}
                  className={clsx(
                    "w-full border px-3 py-2 text-left font-mono text-[12px] transition",
                    graphId === g.id
                      ? "border-[var(--text-secondary)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                      : "border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-muted)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        {/* Budget */}
        <Field label="Budget (USD)" hint="optional">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={budgetUsd}
            onChange={(e) => setBudgetUsd(e.target.value)}
            placeholder="e.g. 2.00"
            className={inputCls}
          />
        </Field>

        <Field label={t.addTask.descriptionLabel}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.addTask.descriptionPlaceholder}
            rows={2}
            className={clsx(inputCls, "resize-none")}
          />
        </Field>

        <Field label={t.addTask.analysisLabel} hint={t.addTask.analysisHint}>
          <textarea
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
            placeholder={t.addTask.analysisPlaceholder}
            rows={9}
            className={clsx(inputCls, "resize-y font-mono text-xs")}
          />
        </Field>

        {selectedProjectId && (
          hasRemote ? (
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={createGhIssue}
                onChange={(e) => setCreateGhIssue(e.target.checked)}
                className="accent-[var(--text-primary)]"
              />
              {t.importIssues.createIssueCheckbox}
            </label>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
              <input type="checkbox" disabled className="opacity-30" />
              <span>{t.importIssues.createIssueCheckbox}</span>
              <span className="text-[var(--text-muted)]">—</span>
              <button
                type="button"
                onClick={() => { onClose(); if (selectedProjectId) openProjectDetail(selectedProjectId); }}
                className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                {t.importIssues.noRemoteHint} {t.importIssues.configureLink}
              </button>
            </div>
          )
        )}

        {error && (
          <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
            {error}
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={handleClose}
            className="btn-ghost px-4 py-2 text-[12px] font-medium"
          >
            {t.addTask.cancel}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-ink inline-flex items-center gap-2 px-5 py-2 text-[12px] font-medium disabled:opacity-50"
          >
            {loading ? t.addTask.submitting : t.addTask.submit}
            <span aria-hidden>→</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls =
  "w-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition focus:border-[var(--text-secondary)]";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">
          {label}
          {required && (
            <span className="ml-1 text-[var(--status-error)]">*</span>
          )}
        </span>
        {hint && (
          <span className="ml-auto text-[11px] italic text-[var(--text-muted)]">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
