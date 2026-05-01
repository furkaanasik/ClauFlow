"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { cloneProject } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { GithubRepo } from "@/types";

interface CloneRepoModalProps {
  repo: GithubRepo | null;
  onClose: () => void;
}

export function CloneRepoModal({ repo, onClose }: CloneRepoModalProps) {
  const t = useTranslation();
  const [targetPath, setTargetPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentTargetPath = useRef<string | null>(null);

  const cloneStatus = useBoardStore((s) => s.cloneStatus);
  const status = currentTargetPath.current ? cloneStatus[currentTargetPath.current] : null;

  useEffect(() => {
    if (repo) {
      setTargetPath(`~/Projects/AI/${repo.name}`);
      setError(null);
      setSubmitting(false);
      currentTargetPath.current = null;
    }
  }, [repo]);

  useEffect(() => {
    if (!status) return;
    if (status.status === "done") {
      currentTargetPath.current = null;
      onClose();
    } else if (status.status === "error") {
      setError(status.message);
      setSubmitting(false);
    }
  }, [status, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await cloneProject({
        repoUrl: `${repo.url}.git`,
        targetPath,
        name: repo.name,
      });
      currentTargetPath.current = result.targetPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const isCloning = submitting || status?.status === "cloning";

  const updatedLabel = repo?.updatedAt
    ? new Date(repo.updatedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
    : null;

  const visibilityLabel =
    repo?.visibility?.toLowerCase() === "private"
      ? t.cloneModal.visibilityPrivate
      : t.cloneModal.visibilityPublic;

  return (
    <Modal
      open={repo !== null}
      onClose={isCloning ? () => { } : onClose}
      title={t.cloneModal.title}
      size="xl"
    >
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {repo && (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-[var(--text-primary)]">{repo.name}</span>
              <span className="font-mono text-xs text-[var(--text-faint)]">{repo.nameWithOwner}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              {t.cloneModal.targetDirLabel}
            </label>
            <input
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder={t.cloneModal.targetDirPlaceholder}
              disabled={isCloning}
              required
              className="w-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--status-error)]">
              {t.cloneModal.errorPrefix} {error}
            </p>
          )}

          {isCloning && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <Spinner />
              <span>{t.cloneModal.cloning}</span>
            </div>
          )}

          <div className="mt-auto flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isCloning}
              className="border border-[var(--border)] px-4 py-2 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {t.cloneModal.cancel}
            </button>
            <button
              type="submit"
              disabled={isCloning}
              className="btn-ink px-4 py-2 text-xs disabled:opacity-50"
            >
              {isCloning ? t.cloneModal.submitting : t.cloneModal.submit}
            </button>
          </div>
        </form>

        {repo && (
          <aside className="flex max-h-[60vh] flex-col overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
              §  {t.cloneModal.repoInfoTitle}
            </span>

            <h3 className="t-display mt-2 break-words text-lg leading-tight text-[var(--text-primary)]">
              {repo.name}
            </h3>
            <span className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-faint)]">
              {repo.nameWithOwner}
            </span>

            <div className="mt-4 flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
                  {t.cloneModal.description}
                </span>
                <p className="leading-relaxed text-[var(--text-secondary)]">
                  {repo.description?.trim() || (
                    <em className="text-[var(--text-faint)]">{t.cloneModal.noDescription}</em>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
                    {t.cloneModal.visibility}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-primary)]">
                    {visibilityLabel}
                  </span>
                </div>
                {updatedLabel && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
                      {t.cloneModal.updatedAt}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-primary)]">
                      {updatedLabel}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto flex items-center justify-between gap-2 border border-[var(--border)] px-3 py-2 pt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            >
              <span>{t.cloneModal.viewOnGithub}</span>
              <span aria-hidden>↗</span>
            </a>
          </aside>
        )}
      </div>
    </Modal>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin"
      style={{ color: "var(--accent-primary)" }}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
