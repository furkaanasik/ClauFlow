"use client";

import { useEffect, useState } from "react";
import { api, type ClaudeAgent } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTranslation } from "@/hooks/useTranslation";

interface AgentEditDrawerProps {
  projectId: string;
  slug: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  existingSlugs: string[];
}

const MODEL_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "inherit",                       label: "inherit" },
  { value: "opus",                          label: "opus (alias)" },
  { value: "sonnet",                        label: "sonnet (alias)" },
  { value: "haiku",                         label: "haiku (alias)" },
  { value: "claude-opus-4-7",               label: "claude-opus-4-7" },
  { value: "claude-sonnet-4-6",             label: "claude-sonnet-4-6" },
  { value: "claude-haiku-4-5-20251001",     label: "claude-haiku-4-5-20251001" },
];

export function AgentEditDrawer({
  projectId,
  slug,
  open,
  onClose,
  onSaved,
  onDeleted,
  existingSlugs,
}: AgentEditDrawerProps) {
  const t = useTranslation();
  const ca = t.claudeAgents;
  const isEdit = slug !== null;

  const [loading, setLoading] = useState(false);
  const [original, setOriginal] = useState<ClaudeAgent | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const isPresetModel = MODEL_PRESETS.some((m) => m.value === model);
  const modelSelectValue = model === "" ? "" : isPresetModel ? model : "__custom__";

  const resetForm = () => {
    setOriginal(null);
    setNewSlug("");
    setName("");
    setModel("");
    setDescription("");
    setBody("");
    setError(null);
    setSavedFlash(false);
  };

  useEffect(() => {
    if (!open) return;
    if (!isEdit || !slug) {
      resetForm();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getClaudeAgent(projectId, slug)
      .then((a) => {
        if (cancelled) return;
        setOriginal(a);
        setNewSlug(a.slug);
        setName(a.name);
        setModel(a.model ?? "");
        setDescription(a.description ?? "");
        setBody(a.body);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : ca.loadError);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, slug, projectId, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug);
  const slugDuplicate = !isEdit && existingSlugs.includes(newSlug);

  const isDirty = isEdit
    ? (original
        ? name !== original.name ||
          model !== (original.model ?? "") ||
          description !== (original.description ?? "") ||
          body !== original.body
        : false)
    : newSlug.length > 0 || name.length > 0 || description.length > 0 || body.length > 0;

  const canSave =
    !saving &&
    !loading &&
    slugValid &&
    !slugDuplicate &&
    (isEdit ? isDirty : true);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: name || newSlug,
        model: model || undefined,
        description: description || undefined,
        body,
      };
      if (isEdit && slug) {
        await api.updateClaudeAgent(projectId, slug, payload);
      } else {
        await api.createClaudeAgent(projectId, { slug: newSlug, ...payload });
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : ca.saveError;
      if (msg.includes("agent_already_exists")) {
        setError(ca.duplicate);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!isEdit || !slug) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteClaudeAgent(projectId, slug);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : ca.deleteError);
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="relative flex h-[85vh] w-full max-w-[60rem] flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-base)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]">
            {isEdit ? ca.save : ca.create}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border)] p-1.5 text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {error && (
            <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
              {error}
            </div>
          )}

          {savedFlash && (
            <div className="border border-[var(--accent-primary)] px-3 py-2 text-[12px] text-[var(--accent-primary)]">
              {ca.saving}
            </div>
          )}

          {/* Slug + Name */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.slugLabel}</span>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                disabled={isEdit || loading || saving}
                placeholder={ca.slugPlaceholder}
                spellCheck={false}
                className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-60"
              />
              {!isEdit && newSlug && !slugValid && (
                <span className="text-[11px] text-[var(--status-error)]">{ca.slugError}</span>
              )}
              {!isEdit && slugValid && slugDuplicate && (
                <span className="text-[11px] text-[var(--status-error)]">{ca.duplicate}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.nameLabel}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading || saving}
                placeholder={ca.namePlaceholder}
                className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
              />
            </label>
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.modelLabel}</span>
            <div className="flex gap-2">
              <select
                value={modelSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") setModel("");
                  else if (v === "__custom__") setModel(isPresetModel ? "" : model || " ");
                  else setModel(v);
                }}
                disabled={loading || saving}
                className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
              >
                <option value="">{ca.modelInherit}</option>
                {MODEL_PRESETS.filter((m) => m.value !== "inherit").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                <option value="__custom__">{ca.modelCustom}</option>
              </select>
              {modelSelectValue === "__custom__" && (
                <input
                  value={model.trim()}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={loading || saving}
                  placeholder={ca.modelCustomPlaceholder}
                  spellCheck={false}
                  autoFocus
                  className="flex-1 border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
                />
              )}
            </div>
          </div>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.descriptionLabel}</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading || saving}
              placeholder={ca.descriptionPlaceholder}
              className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
            />
          </label>

          {/* Body */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.bodyLabel}</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={loading || saving}
              rows={16}
              spellCheck={false}
              placeholder={ca.bodyPlaceholder}
              className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition focus:border-[var(--text-secondary)]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || saving}
                className="border border-[var(--status-error)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)] disabled:opacity-40"
              >
                {deleting ? ca.deleting : ca.delete}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-50"
            >
              {ca.cancel}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSave}
              className="btn-ink px-4 py-1.5 text-[12px] disabled:opacity-50"
            >
              {saving
                ? (isEdit ? ca.saving : ca.creating)
                : (isEdit ? ca.save : ca.create)}
            </button>
          </div>
        </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={ca.confirmDeleteTitle}
        description={ca.confirmDeleteDescription}
        confirmLabel={ca.delete}
        cancelLabel={ca.cancel}
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

export type { AgentEditDrawerProps };
