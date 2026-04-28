"use client";

import clsx from "clsx";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
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
  const upsertTask        = useBoardStore((s) => s.upsertTask);
  const toast             = useToast();
  const t                 = useTranslation();

  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [analysis,    setAnalysis]    = useState("");
  const [priority,    setPriority]    = useState<Priority>("medium");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const reset = () => {
    setTitle(""); setDescription(""); setAnalysis(""); setPriority("medium"); setError(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) { setError(t.addTask.errorNoProject); return; }
    if (!title.trim())       { setError(t.addTask.errorNoTitle);    return; }
    setLoading(true);
    setError(null);
    try {
      const task = await api.createTask({
        projectId: selectedProjectId,
        title:       title.trim(),
        description: description.trim() || undefined,
        analysis:    analysis.trim()    || undefined,
        priority,
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
                style={
                  priority === value
                    ? { boxShadow: `inset 0 -2px 0 ${PRIO_COLOR[value]}` }
                    : {}
                }
              >
                <span
                  className="h-1.5 w-1.5"
                  style={{ background: PRIO_COLOR[value] }}
                />
                {t.addTask.priorities[value]}
              </button>
            ))}
          </div>
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
