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

const PRIORITY_KEYS: { value: Priority; style: string; activeStyle: string }[] = [
  {
    value: "low",
    style:       "border-zinc-700  text-zinc-400",
    activeStyle: "border-emerald-600 bg-emerald-950/60 text-emerald-300",
  },
  {
    value: "medium",
    style:       "border-zinc-700  text-zinc-400",
    activeStyle: "border-yellow-600  bg-yellow-950/60  text-yellow-300",
  },
  {
    value: "high",
    style:       "border-zinc-700  text-zinc-400",
    activeStyle: "border-orange-600  bg-orange-950/60  text-orange-300",
  },
  {
    value: "critical",
    style:       "border-zinc-700  text-zinc-400",
    activeStyle: "border-red-600    bg-red-950/60    text-red-300",
  },
];

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
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Title */}
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

        {/* Priority — button group */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{t.addTask.priorityLabel}</span>
          <div className="flex gap-1.5">
            {PRIORITY_KEYS.map(({ value, style, activeStyle }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPriority(value)}
                className={clsx(
                  "flex-1 rounded-lg border py-1 text-[10px] font-medium transition",
                  priority === value ? activeStyle : style,
                  priority !== value && "hover:border-zinc-600 hover:text-zinc-300",
                )}
              >
                {t.addTask.priorities[value]}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <Field label={t.addTask.descriptionLabel}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.addTask.descriptionPlaceholder}
            rows={2}
            className={clsx(inputCls, "resize-none")}
          />
        </Field>

        {/* Analysis */}
        <Field
          label={t.addTask.analysisLabel}
          hint={t.addTask.analysisHint}
        >
          <textarea
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
            placeholder={t.addTask.analysisPlaceholder}
            rows={8}
            className={clsx(inputCls, "resize-y font-mono text-xs")}
          />
        </Field>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-1.5 pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-xs transition"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          >
            {t.addTask.cancel}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
          >
            {loading ? t.addTask.submitting : t.addTask.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-zinc-600 outline-none transition focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/20";

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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
          {required && <span className="ml-1 text-red-400">*</span>}
        </span>
        {hint && <span className="text-[10px]" style={{ color: "var(--text-muted)", opacity: 0.6 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
