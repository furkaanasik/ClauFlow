"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { SectionPill, StatusPill } from "@/components/ui/Pills";
import { IconAlert, IconArrowUpRight, IconClock, IconDownload, IconFolder, IconGithub, IconLock, IconEye } from "@/components/ui/icons";
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
  const tc = t.cloneModal;
  const formId = useId();
  const [targetPath, setTargetPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentTargetPath = useRef<string | null>(null);

  const cloneStatus = useBoardStore((s) => s.cloneStatus);
  const status = currentTargetPath.current ? cloneStatus[currentTargetPath.current] : null;

  // Keep showing the last repo while the modal plays its exit animation.
  const lastRepo = useRef<GithubRepo | null>(null);
  if (repo) lastRepo.current = repo;
  const shown = repo ?? lastRepo.current;

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

  const updatedLabel = shown?.updatedAt
    ? new Date(shown.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  const isPrivate = shown?.visibility?.toLowerCase() === "private";
  const visibilityLabel = isPrivate ? tc.visibilityPrivate : tc.visibilityPublic;

  return (
    <Modal
      open={repo !== null}
      onClose={isCloning ? () => {} : onClose}
      title={tc.title}
      description={tc.modalHint}
      icon={<IconDownload size={18} />}
      size="xl"
      footerStart={
        isCloning ? (
          <StatusPill status="doing" live>
            {tc.cloning}
          </StatusPill>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isCloning}>
            {tc.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" icon={<IconDownload size={15} />} loading={isCloning}>
            {isCloning ? tc.submitting : tc.submit}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-5">
          {shown && (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-2 border-line bg-ink text-[var(--on-ink)] shadow-hard"
              >
                <IconGithub size={20} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[16px] font-bold text-ink">{shown.name}</div>
                <div className="truncate font-mono text-[12px] text-ink-3">{shown.nameWithOwner}</div>
              </div>
            </div>
          )}

          <Field label={tc.targetDirLabel}>
            {({ id }) => (
              <Input
                id={id}
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder={tc.targetDirPlaceholder}
                disabled={isCloning}
                required
                icon={<IconFolder size={14} />}
                className="font-mono"
                autoFocus
              />
            )}
          </Field>

          {/* Where it lands: a little path ribbon */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] text-ink-3" aria-hidden>
            {targetPath
              .split("/")
              .filter(Boolean)
              .map((seg, i, arr) => (
                <span key={`${seg}-${i}`} className="flex items-center gap-1.5">
                  <span
                    className={
                      i === arr.length - 1
                        ? "rounded-[6px] border-2 border-line bg-mustard px-1.5 py-0.5 font-bold text-[var(--on-mustard)]"
                        : "rounded-[6px] border-2 border-hair bg-panel px-1.5 py-0.5"
                    }
                  >
                    {seg}
                  </span>
                  {i < arr.length - 1 && <span>/</span>}
                </span>
              ))}
          </div>

          {error && (
            <div role="alert" className="ui-banner ui-banner--error">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>
                {tc.errorPrefix} {error}
              </span>
            </div>
          )}
        </form>

        {shown && (
          <aside className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto rounded-[14px] border-2 border-line bg-sunken p-4">
            <SectionPill size="sm" icon={<IconGithub size={12} />} className="self-start">
              {tc.repoInfoTitle}
            </SectionPill>

            <div>
              <h3 className="t-display break-words text-[22px] leading-tight text-ink">{shown.name}</h3>
              <span className="break-all font-mono text-[12px] text-ink-3">{shown.nameWithOwner}</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="t-label">{tc.description}</span>
              <p className="text-[13px] leading-relaxed text-ink-2">
                {shown.description?.trim() || <em className="text-ink-3">{tc.noDescription}</em>}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-[10px] border-2 border-line bg-panel p-2.5">
                <span className="t-label">{tc.visibility}</span>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  {isPrivate ? <IconLock size={13} /> : <IconEye size={13} />}
                  {visibilityLabel}
                </span>
              </div>
              {updatedLabel && (
                <div className="flex flex-col gap-1 rounded-[10px] border-2 border-line bg-panel p-2.5">
                  <span className="t-label">{tc.updatedAt}</span>
                  <span className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-ink">
                    <IconClock size={13} />
                    {updatedLabel}
                  </span>
                </div>
              )}
            </div>

            <a
              href={shown.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--secondary ui-btn--sm ui-focus mt-auto !justify-between"
            >
              <span>{tc.viewOnGithub}</span>
              <IconArrowUpRight size={14} />
            </a>
          </aside>
        )}
      </div>
    </Modal>
  );
}
