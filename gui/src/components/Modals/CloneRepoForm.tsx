"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GithubConnectModal } from "@/components/Auth/GithubConnectModal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { IconAlert, IconFolder, IconGithub, IconLock, IconRetry, IconSearch } from "@/components/ui/icons";
import { cloneProject } from "@/lib/api";
import { errorText } from "@/lib/errorText";
import { useBoardStore } from "@/store/boardStore";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { useGithubRepos } from "@/hooks/useGithubRepos";
import { useTranslation } from "@/hooks/useTranslation";
import type { GithubRepo } from "@/types";

const stripGit = (s: string | null | undefined) => (s ?? "").replace(/\.git$/, "").toLowerCase();

interface CloneRepoFormProps {
  formId: string;
  /** Called once the clone finished and the project was added (and selected). */
  onCloned: () => void;
  /** Lets the modal lock its footer / close while a clone is running. */
  onBusyChange: (busy: boolean) => void;
  /** Lets the modal enable its submit button once a repo is picked. */
  onReadyChange: (ready: boolean) => void;
}

/**
 * "Clone from GitHub" tab of the new-project modal (plan §3/18): searchable
 * list of the account's repos (already-added ones filtered out) plus the
 * target path. Not connected → a connect prompt instead of the list.
 */
export function CloneRepoForm({ formId, onCloned, onBusyChange, onReadyChange }: CloneRepoFormProps) {
  const t = useTranslation();
  const tc = t.cloneModal;
  const { status: auth, loading: authLoading } = useGithubAuth();
  const { repos, loading, error: reposError, refresh } = useGithubRepos();
  const projects = useBoardStore((s) => s.projects);
  const cloneStatus = useBoardStore((s) => s.cloneStatus);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GithubRepo | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const pendingPath = useRef<string | null>(null);

  const status = pendingPath.current ? cloneStatus[pendingPath.current] : null;
  const isCloning = submitting || status?.status === "cloning";

  const available = useMemo(() => {
    const localRemotes = new Set(projects.map((p) => stripGit(p.remote)));
    return repos.filter(
      (r) => !r.isLocal && !localRemotes.has(stripGit(r.url)) && !localRemotes.has(stripGit(r.sshUrl)),
    );
  }, [repos, projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (r) => r.nameWithOwner.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }, [available, query]);

  useEffect(() => onBusyChange(isCloning), [isCloning, onBusyChange]);
  useEffect(() => onReadyChange(Boolean(selected && targetPath.trim())), [selected, targetPath, onReadyChange]);

  useEffect(() => {
    if (!status) return;
    if (status.status === "done") {
      pendingPath.current = null;
      setSubmitting(false);
      onCloned();
    } else if (status.status === "error") {
      pendingPath.current = null;
      setError(status.message);
      setSubmitting(false);
    }
  }, [status, onCloned]);

  const pick = (repo: GithubRepo) => {
    if (isCloning) return;
    setSelected(repo);
    setTargetPath(`~/Projects/AI/${repo.name}`);
    setError(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !targetPath.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await cloneProject({
        repoUrl: `${selected.url}.git`,
        targetPath: targetPath.trim(),
        name: selected.name,
      });
      pendingPath.current = result.targetPath;
    } catch (err) {
      setError(errorText(t, err));
      setSubmitting(false);
    }
  }

  const loadingRows = (
    <div className="flex flex-col gap-2" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="ui-hatch h-[3.25rem] rounded-[10px] border-2 border-dashed border-hair" />
      ))}
    </div>
  );

  if (authLoading) return loadingRows;

  if (!auth.connected) {
    return (
      <>
        <div className="ui-hatch flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-10 text-center">
          <span aria-hidden className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-ink text-[var(--on-ink)] shadow-hard">
            <IconGithub size={20} />
          </span>
          <p className="max-w-sm text-[13px] text-ink-2">{tc.connectHint}</p>
          <Button variant="primary" size="sm" icon={<IconGithub size={14} />} onClick={() => setConnectOpen(true)}>
            {tc.connect}
          </Button>
        </div>
        <GithubConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    );
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        icon={<IconSearch size={14} />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tc.searchPlaceholder}
        aria-label={tc.searchPlaceholder}
        spellCheck={false}
        disabled={isCloning}
      />

      {reposError ? (
        <div role="alert" className="ui-banner ui-banner--error items-center">
          <IconAlert size={15} className="shrink-0" />
          <span className="flex-1">{errorText(t, reposError)}</span>
          <Button size="sm" variant="secondary" icon={<IconRetry size={13} />} onClick={() => void refresh()}>
            {tc.retry}
          </Button>
        </div>
      ) : loading && repos.length === 0 ? (
        loadingRows
      ) : filtered.length === 0 ? (
        <p className="rounded-[10px] border-2 border-dashed border-hair px-4 py-6 text-center text-[13px] text-ink-3">
          {available.length === 0 ? tc.emptyAll : tc.emptySearch}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={tc.listLabel}
          className="flex max-h-[15rem] flex-col gap-1.5 overflow-y-auto p-1"
        >
          {filtered.map((repo) => {
            const checked = selected?.nameWithOwner === repo.nameWithOwner;
            const isPrivate = repo.visibility?.toLowerCase() === "private";
            return (
              <button
                key={repo.nameWithOwner}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={isCloning}
                onClick={() => pick(repo)}
                className="ui-option !items-start !gap-2.5 !py-2"
              >
                <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border-2 border-line bg-ink text-[var(--on-ink)]">
                  <IconGithub size={13} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-bold text-ink">{repo.name}</span>
                    {isPrivate && (
                      <span className="flex-none text-ink-3" title={tc.visibilityPrivate}>
                        <IconLock size={11} />
                        <span className="sr-only">{tc.visibilityPrivate}</span>
                      </span>
                    )}
                  </span>
                  <span className="truncate font-mono text-[11px] text-ink-3">{repo.nameWithOwner}</span>
                  {repo.description?.trim() && (
                    <span className="mt-0.5 line-clamp-1 text-[12px] text-ink-2">{repo.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
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
            />
          )}
        </Field>
      )}

      {error && (
        <div role="alert" className="ui-banner ui-banner--error">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            {tc.errorPrefix} {error}
          </span>
        </div>
      )}
    </form>
  );
}
