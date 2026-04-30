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
      setTargetPath(`~/Projects/${repo.name}`);
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
        repoUrl: repo.sshUrl,
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

  return (
    <Modal open={repo !== null} onClose={isCloning ? () => {} : onClose} title={t.cloneModal.title}>
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

        <div className="flex justify-end gap-2 pt-1">
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
