"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { githubApi, type GhIssue } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";

interface ImportIssuesModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportIssuesModal({ open, onClose }: ImportIssuesModalProps) {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const upsertTask        = useBoardStore((s) => s.upsertTask);
  const toast             = useToast();
  const t                 = useTranslation();

  const [issues,   setIssues]   = useState<GhIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (!open || !selectedProjectId) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    githubApi.listIssues(selectedProjectId)
      .then((r) => setIssues(r.issues))
      .catch((err) => setError(err instanceof Error ? err.message : t.importIssues.loadError))
      .finally(() => setLoading(false));
  }, [open, selectedProjectId]);

  const allSelected = issues.length > 0 && selected.size === issues.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(issues.map((i) => i.number)));
  };

  const toggle = (number: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(number) ? next.delete(number) : next.add(number);
      return next;
    });
  };

  const handleImport = async () => {
    if (!selectedProjectId || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const toImport = issues.filter((i) => selected.has(i.number));
      const { tasks } = await githubApi.importIssues(selectedProjectId, toImport);
      tasks.forEach((task) => upsertTask(task));
      toast.success(t.importIssues.successToast(tasks.length));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.importIssues.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t.importIssues.modalTitle} size="lg">
      {loading && (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{t.importIssues.loading}</p>
      )}
      {!loading && error && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
          {error}
        </div>
      )}
      {!loading && !error && issues.length === 0 && (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{t.importIssues.empty}</p>
      )}
      {!loading && issues.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="self-start text-[11px] font-medium text-[var(--text-secondary)] underline underline-offset-2"
          >
            {allSelected ? t.importIssues.deselectAll : t.importIssues.selectAll}
          </button>
          <div className="flex max-h-[400px] flex-col gap-1 overflow-y-auto">
            {issues.map((issue) => (
              <label
                key={issue.number}
                className="flex cursor-pointer items-start gap-3 rounded border border-[var(--border)] px-3 py-2.5 hover:border-[var(--text-secondary)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(issue.number)}
                  onChange={() => toggle(issue.number)}
                  className="mt-0.5 accent-[var(--text-primary)]"
                />
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    <span className="text-[var(--text-muted)]">{t.importIssues.issueNumber}{issue.number}</span>
                    {" "}{issue.title}
                  </span>
                  {issue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {issue.labels.map((l) => (
                        <span
                          key={l.name}
                          className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                          style={{ background: `#${l.color}22`, color: `#${l.color}` }}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
          {error && (
            <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
              {error}
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost px-4 py-2 text-[12px] font-medium"
            >
              {t.importIssues.cancel}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={selected.size === 0 || saving}
              className="btn-ink inline-flex items-center gap-2 px-5 py-2 text-[12px] font-medium disabled:opacity-50"
            >
              {saving ? t.importIssues.importing : t.importIssues.importButton(selected.size)}
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
