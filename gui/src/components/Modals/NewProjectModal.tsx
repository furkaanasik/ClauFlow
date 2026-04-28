"use client";

import clsx from "clsx";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";

function slugify(value: string): string {
  const TR_MAP: Record<string, string> = {
    ç: "c", Ç: "c",
    ş: "s", Ş: "s",
    ğ: "g", Ğ: "g",
    ü: "u", Ü: "u",
    ö: "o", Ö: "o",
    ı: "i", İ: "i",
  };
  return value
    .split("")
    .map((ch) => TR_MAP[ch] ?? ch)
    .join("")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,10}[a-z0-9]$|^[a-z0-9]{2}$/;

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const addProject = useBoardStore((s) => s.addProject);
  const selectProject = useBoardStore((s) => s.selectProject);
  const t = useTranslation();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [remote, setRemote] = useState("");
  const [createGithub, setCreateGithub] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setSlugError(null);
    setRepoPath("");
    setDefaultBranch("main");
    setRemote("");
    setCreateGithub(false);
    setRepoName("");
    setIsPrivate(true);
    setAiPrompt("");
    setError(null);
    setGithubWarning(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoPath.trim()) {
      setError(t.newProject.errorRequired);
      return;
    }
    const finalSlug = slug.trim() || slugify(name.trim());
    if (!SLUG_REGEX.test(finalSlug)) {
      setSlugError(t.newProject.slugError);
      return;
    }
    setSlugError(null);
    setSubmitting(true);
    setError(null);
    setGithubWarning(null);
    try {
      const trimmedPrompt = aiPrompt.trim();
      const { project, githubError } = await api.createProject({
        name: name.trim(),
        slug: finalSlug,
        repoPath: repoPath.trim(),
        defaultBranch: defaultBranch.trim() || "main",
        remote: createGithub ? undefined : (remote.trim() || null),
        ...(createGithub && {
          createGithubRepo: true,
          repoName: repoName.trim() || undefined,
          isPrivate,
        }),
        ...(trimmedPrompt && {
          aiPrompt: trimmedPrompt,
        }),
      });
      addProject(project);
      selectProject(project.id);
      if (githubError) {
        setGithubWarning(githubError);
        setSubmitting(false);
        return;
      }
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={t.newProject.modalTitle}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.newProject.nameLabel} required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => {
              if (!slugEdited && e.target.value.trim()) {
                setSlug(slugify(e.target.value.trim()));
              }
            }}
            className={inputCls}
            placeholder={t.newProject.namePlaceholder}
            autoFocus
            disabled={submitting}
          />
        </Field>

        <Field
          label={t.newProject.slugLabel}
         
          hint={t.newProject.slugHint}
        >
          <div className="relative">
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 12);
                setSlug(v);
                setSlugEdited(true);
                setSlugError(null);
              }}
              onBlur={() => {
                if (slug && !SLUG_REGEX.test(slug)) {
                  setSlugError(t.newProject.slugError);
                }
              }}
              className={clsx(
                inputCls,
                "pr-14 font-mono",
                slugError && "border-[var(--status-error)]",
              )}
              placeholder={t.newProject.slugPlaceholder}
              disabled={submitting}
              maxLength={12}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
              {String(slug.length).padStart(2, "0")}/12
            </span>
          </div>
          {slugError && (
            <span className="text-[11px] text-[var(--status-error)]">
              {slugError}
            </span>
          )}
        </Field>

        <Field label={t.newProject.repoPathLabel} required>
          <input
            type="text"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            className={clsx(inputCls, "font-mono")}
            placeholder="/home/user/projects/my-repo"
            disabled={submitting}
          />
        </Field>

        <Field label={t.newProject.aiPromptLabel}>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={4}
            className={clsx(inputCls, "resize-none")}
            placeholder={t.newProject.aiPromptPlaceholder}
            disabled={submitting}
          />
        </Field>

        <Field label={t.newProject.defaultBranchLabel}>
          <input
            type="text"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            className={clsx(inputCls, "font-mono")}
            placeholder="main"
            disabled={submitting}
          />
        </Field>

        {/* GitHub repo creation toggle */}
        <label
          className={clsx(
            "flex cursor-pointer items-center gap-3 border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-3 transition",
            createGithub && "border-[var(--accent-primary)]",
          )}
        >
          <span
            className={clsx(
              "flex h-4 w-4 shrink-0 items-center justify-center border",
              createGithub
                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-ink)]"
                : "border-[var(--border-strong)]",
            )}
          >
            {createGithub && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="2 6 5 9 10 3" />
              </svg>
            )}
          </span>
          <input
            type="checkbox"
            checked={createGithub}
            onChange={(e) => setCreateGithub(e.target.checked)}
            disabled={submitting}
            className="sr-only"
          />
          <div className="flex flex-1 flex-col">
            <span className="text-sm text-[var(--text-primary)]">
              {t.newProject.createGithubLabel}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Uses GitHub CLI device flow
            </span>
          </div>
        </label>

        {createGithub && (
          <>
            <Field label={t.newProject.repoNameLabel}>
              <input
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                className={clsx(inputCls, "font-mono")}
                placeholder={name.trim() || t.newProject.namePlaceholder}
                disabled={submitting}
              />
            </Field>

            <Field label={t.newProject.visibilityLabel}>
              <div className="flex gap-px border border-[var(--border)] bg-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  disabled={submitting}
                  className={clsx(
                    "flex-1 px-3 py-2 text-[12px] font-medium transition",
                    isPrivate
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {t.newProject.visibilityPrivate}
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  disabled={submitting}
                  className={clsx(
                    "flex-1 px-3 py-2 text-[12px] font-medium transition",
                    !isPrivate
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {t.newProject.visibilityPublic}
                </button>
              </div>
            </Field>
          </>
        )}

        {!createGithub && (
          <Field label={t.newProject.remoteLabel}>
            <input
              type="text"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              className={clsx(inputCls, "font-mono")}
              placeholder="git@github.com:org/repo.git"
              disabled={submitting}
            />
          </Field>
        )}

        {error && (
          <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
            {error}
          </div>
        )}

        {githubWarning && (
          <div className="border border-[var(--status-warning)] bg-[var(--status-doing-ink)] px-3 py-2 text-xs text-[var(--status-warning)]">
            {t.newProject.githubWarningPrefix}{githubWarning}
          </div>
        )}

        <div className="mt-2 flex justify-between gap-2 border-t border-[var(--border)] pt-4">
          {githubWarning ? (
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="btn-ink ml-auto px-5 py-2 text-[12px] font-medium"
            >
              {t.newProject.close}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="btn-ghost px-4 py-2 text-[12px] font-medium"
              >
                {t.newProject.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-ink inline-flex items-center gap-2 px-5 py-2 text-[12px] font-medium disabled:opacity-50"
              >
                {submitting ? t.newProject.submitting : t.newProject.submit}
                <span aria-hidden>→</span>
              </button>
            </>
          )}
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
