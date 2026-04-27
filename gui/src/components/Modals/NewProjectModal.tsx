"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const addProject = useBoardStore((s) => s.addProject);
  const selectProject = useBoardStore((s) => s.selectProject);
  const t = useTranslation();

  const [name, setName] = useState("");
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
    setSubmitting(true);
    setError(null);
    setGithubWarning(null);
    try {
      const trimmedPrompt = aiPrompt.trim();
      const { project, githubError } = await api.createProject({
        name: name.trim(),
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Field label={t.newProject.nameLabel} required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder={t.newProject.namePlaceholder}
            autoFocus
            disabled={submitting}
          />
        </Field>

        <Field label={t.newProject.repoPathLabel} required>
          <input
            type="text"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            className={inputCls}
            placeholder="/home/user/projects/my-repo"
            disabled={submitting}
          />
        </Field>

        {/* AI Prompt */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-400">{t.newProject.aiPromptLabel}</span>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={4}
            className={`${inputCls} resize-none`}
            placeholder={t.newProject.aiPromptPlaceholder}
            disabled={submitting}
          />
        </label>

<Field label={t.newProject.defaultBranchLabel}>
          <input
            type="text"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            className={inputCls}
            placeholder="main"
            disabled={submitting}
          />
        </Field>

        {/* GitHub repo creation toggle */}
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 transition hover:border-zinc-700">
          <input
            type="checkbox"
            checked={createGithub}
            onChange={(e) => setCreateGithub(e.target.checked)}
            disabled={submitting}
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          <span className="text-xs text-zinc-300">{t.newProject.createGithubLabel}</span>
        </label>

        {createGithub && (
          <>
            <Field label={t.newProject.repoNameLabel}>
              <input
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                className={inputCls}
                placeholder={name.trim() || t.newProject.namePlaceholder}
                disabled={submitting}
              />
            </Field>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-zinc-400">{t.newProject.visibilityLabel}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  disabled={submitting}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    isPrivate
                      ? "bg-emerald-700 text-white"
                      : "border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {t.newProject.visibilityPrivate}
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  disabled={submitting}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    !isPrivate
                      ? "bg-emerald-700 text-white"
                      : "border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {t.newProject.visibilityPublic}
                </button>
              </div>
            </div>
          </>
        )}

        {!createGithub && (
          <Field label={t.newProject.remoteLabel}>
            <input
              type="text"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              className={inputCls}
              placeholder="git@github.com:org/repo.git"
              disabled={submitting}
            />
          </Field>
        )}

        {error && (
          <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {githubWarning && (
          <div className="rounded-md border border-yellow-700 bg-yellow-950/40 px-3 py-2 text-xs text-yellow-300">
            {t.newProject.githubWarningPrefix}{githubWarning}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          {githubWarning ? (
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-600"
            >
              {t.newProject.close}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {t.newProject.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
              >
                {submitting ? t.newProject.submitting : t.newProject.submit}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

const inputCls =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none ring-0 transition focus:border-zinc-600";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-zinc-400">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </span>
      {children}
    </label>
  );
}
