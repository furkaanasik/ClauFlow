"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { Project, ProjectPatch, Task } from "@/types";

interface ProjectDetailDrawerProps {
  projectId: string | null;
  onClose: () => void;
}

interface DraftState {
  name: string;
  description: string;
  aiPrompt: string;
  repoPath: string;
  defaultBranch: string;
}

function makeDraft(p: Project): DraftState {
  return {
    name:          p.name,
    description:   p.description ?? "",
    aiPrompt:      p.aiPrompt ?? "",
    repoPath:      p.repoPath,
    defaultBranch: p.defaultBranch,
  };
}

function draftsEqual(a: DraftState, b: DraftState): boolean {
  return (
    a.name          === b.name &&
    a.description   === b.description &&
    a.aiPrompt      === b.aiPrompt &&
    a.repoPath      === b.repoPath &&
    a.defaultBranch === b.defaultBranch
  );
}

function planningStatusTone(status?: string) {
  switch (status) {
    case "planning": return "yellow" as const;
    case "done":     return "green" as const;
    case "error":    return "red" as const;
    default:         return "neutral" as const;
  }
}

export function ProjectDetailDrawer({ projectId, onClose }: ProjectDetailDrawerProps) {
  const t = useTranslation();
  const pd = t.projectDetail;

  const project       = useBoardStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const updateProject = useBoardStore((s) => s.updateProject);
  const deleteProject = useBoardStore((s) => s.deleteProject); // used by handleDeleteKanban

  const open = Boolean(projectId && project);

  const [projectTasks, setProjectTasks] = useState<Task[]>([]);

  const stats = useMemo(() => ({
    todo:   projectTasks.filter((t) => t.status === "todo").length,
    doing:  projectTasks.filter((t) => t.status === "doing").length,
    review: projectTasks.filter((t) => t.status === "review").length,
    done:   projectTasks.filter((t) => t.status === "done").length,
  }), [projectTasks]);

  const total = projectTasks.length;
  const donePercent = total > 0 ? Math.round((stats.done / total) * 100) : 0;

  const projectHasActiveTasks = stats.doing > 0 || stats.review > 0;

  const [draft,         setDraft]         = useState<DraftState | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [confirmGithub, setConfirmGithub] = useState(false);
  const [confirmKanban, setConfirmKanban] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Reset state when project changes
  useEffect(() => {
    if (project) {
      setDraft(makeDraft(project));
    } else {
      setDraft(null);
    }
    setError(null);
    setSaving(false);
    setDeleting(false);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch this project's tasks so stats reflect the drawer subject,
  // not whichever project is currently selected on the board.
  useEffect(() => {
    if (!projectId) {
      setProjectTasks([]);
      return;
    }
    let cancelled = false;
    api.getTasks(projectId)
      .then((list) => {
        if (!cancelled) setProjectTasks(list);
      })
      .catch(() => {
        if (!cancelled) setProjectTasks([]);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isDirty = useMemo(() => {
    if (!draft || !project) return false;
    return !draftsEqual(draft, makeDraft(project));
  }, [draft, project]);

  const handleSave = async () => {
    if (!project || !draft) return;
    if (!draft.name.trim()) { setError("Proje adı zorunludur."); return; }
    setSaving(true);
    setError(null);
    try {
      const patch: ProjectPatch = {
        name:          draft.name.trim(),
        description:   draft.description || undefined,
        aiPrompt:      draft.aiPrompt || undefined,
        repoPath:      draft.repoPath.trim(),
        defaultBranch: draft.defaultBranch.trim(),
      };
      const updated = await api.updateProject(project.id, patch);
      updateProject(project.id, updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Güncelleme başarısız.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGithub = async () => {
    if (!project) return;
    setConfirmGithub(false);
    setDeleting(true);
    setError(null);
    try {
      const updated = await api.deleteProjectGithub(project.id);
      updateProject(project.id, { remote: updated.remote });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silme başarısız.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteKanban = async () => {
    if (!project) return;
    setConfirmKanban(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteProject(project.id);
      deleteProject(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silme başarısız.");
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={clsx(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl",
          "transform transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
      >
        {project && draft ? (
          <>
            {/* Header */}
            <header className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {project.planningStatus && project.planningStatus !== "idle" && (
                    <Badge tone={planningStatusTone(project.planningStatus)}>
                      {project.planningStatus}
                    </Badge>
                  )}
                  {project.remote && (
                    <span className="truncate font-mono text-[10px] text-zinc-600">
                      {project.remote}
                    </span>
                  )}
                </div>
                <h2 className="text-sm font-semibold leading-tight text-zinc-100">
                  {project.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Kapat"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {error && (
                <div className="mb-4 whitespace-pre-wrap break-words rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              {/* Stats */}
              <section className="mb-6">
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  {pd.progress}
                </h3>
                {/* Progress bar */}
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${donePercent}%` }}
                  />
                </div>
                <p className="mb-3 text-right font-mono text-[11px] text-zinc-500">
                  {donePercent}%
                </p>
                {/* Task counts */}
                <div className="grid grid-cols-4 gap-2">
                  {(["todo", "doing", "review", "done"] as const).map((s) => (
                    <div
                      key={s}
                      className={clsx(
                        "flex flex-col items-center gap-1 rounded-lg border px-2 py-2",
                        s === "todo"   && "border-zinc-800 bg-zinc-900/60",
                        s === "doing"  && "border-yellow-800/50 bg-yellow-950/20",
                        s === "review" && "border-purple-800/50 bg-purple-950/20",
                        s === "done"   && "border-emerald-800/50 bg-emerald-950/20",
                      )}
                    >
                      <span
                        className={clsx(
                          "text-lg font-bold leading-none",
                          s === "todo"   && "text-zinc-300",
                          s === "doing"  && "text-yellow-300",
                          s === "review" && "text-purple-300",
                          s === "done"   && "text-emerald-300",
                        )}
                      >
                        {stats[s]}
                      </span>
                      <span className="text-[9px] uppercase tracking-widest text-zinc-600">
                        {pd.stats[s]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Planner error */}
              {project.planningStatus === "error" && project.planningError && (
                <section className="mb-6 rounded-xl border border-red-900/60 bg-red-950/20 p-4">
                  <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-red-400">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="8" cy="8" r="7" />
                      <path d="M8 4v5M8 11.5h.01" />
                    </svg>
                    {pd.plannerErrorTitle}
                  </h3>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-900/40 bg-red-950/40 p-2 font-mono text-[11px] leading-relaxed text-red-200">
                    {project.planningError}
                  </pre>
                  <p className="mt-2 text-[11px] text-zinc-500">{pd.plannerErrorHint}</p>
                </section>
              )}

              {/* Form */}
              <section className="mb-6 flex flex-col gap-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  {pd.details}
                </h3>

                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {pd.projectName}
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Proje adı"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {pd.projectDescription}
                  </label>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={2}
                    className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Kısa açıklama..."
                  />
                </div>

                {/* AI Prompt */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {pd.projectAiPrompt}
                  </label>
                  <textarea
                    value={draft.aiPrompt}
                    onChange={(e) => setDraft({ ...draft, aiPrompt: e.target.value })}
                    rows={5}
                    className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Projeyi kısaca tanımla, planner task'lara bölsün..."
                  />
                </div>

                {/* Repo Path */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {pd.projectRepoPath}
                  </label>
                  <input
                    type="text"
                    value={draft.repoPath}
                    onChange={(e) => setDraft({ ...draft, repoPath: e.target.value })}
                    disabled={projectHasActiveTasks}
                    className={clsx(
                      "w-full rounded-lg border px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none",
                      projectHasActiveTasks
                        ? "cursor-not-allowed border-zinc-800 bg-zinc-900/40 text-zinc-600"
                        : "border-zinc-700 bg-zinc-900",
                    )}
                    placeholder="/path/to/repo"
                  />
                  {projectHasActiveTasks && (
                    <p className="mt-1 text-[11px] text-zinc-600">{pd.activeTasksBlockPath}</p>
                  )}
                </div>

                {/* Default Branch */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {pd.projectDefaultBranch}
                  </label>
                  <input
                    type="text"
                    value={draft.defaultBranch}
                    onChange={(e) => setDraft({ ...draft, defaultBranch: e.target.value })}
                    disabled={projectHasActiveTasks}
                    className={clsx(
                      "w-full rounded-lg border px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none",
                      projectHasActiveTasks
                        ? "cursor-not-allowed border-zinc-800 bg-zinc-900/40 text-zinc-600"
                        : "border-zinc-700 bg-zinc-900",
                    )}
                    placeholder="main"
                  />
                  {projectHasActiveTasks && (
                    <p className="mt-1 text-[11px] text-zinc-600">{pd.activeTasksBlockPath}</p>
                  )}
                </div>
              </section>

              {/* External link */}
              {project.remote && (
                <section className="mb-6">
                  <a
                    href={project.remote}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-blue-400 transition hover:border-zinc-500 hover:text-blue-300"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    {pd.openInGithub}
                  </a>
                </section>
              )}

              {/* Danger Zone */}
              <section className="rounded-xl border border-red-900/60 bg-red-950/10 p-4">
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-red-500">
                  {pd.dangerZone}
                </h3>
                <div className="flex flex-col gap-2">
                  {project.remote && (
                    <button
                      type="button"
                      onClick={() => setConfirmGithub(true)}
                      disabled={deleting}
                      className="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-2 text-sm text-red-400 transition hover:bg-red-900/40 disabled:opacity-50 text-left"
                    >
                      {deleting ? pd.deleting : pd.deleteFromGithub}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmKanban(true)}
                    disabled={deleting}
                    className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-400 transition hover:border-red-800/60 hover:bg-red-950/20 hover:text-red-400 disabled:opacity-50 text-left"
                  >
                    {deleting ? pd.deleting : pd.deleteFromKanban}
                  </button>
                </div>
              </section>
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-end gap-1.5 border-t border-zinc-800 bg-zinc-950/80 px-4 py-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
              >
                {pd.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? pd.saving : pd.saveChanges}
              </button>
            </footer>
          </>
        ) : null}
      </aside>

      <ConfirmDialog
        open={confirmGithub}
        title={pd.deleteFromGithub}
        description={pd.confirmDeleteGithub}
        confirmLabel={pd.deleteFromGithub}
        cancelLabel={pd.cancel}
        variant="danger"
        onConfirm={handleDeleteGithub}
        onCancel={() => setConfirmGithub(false)}
      />

      <ConfirmDialog
        open={confirmKanban}
        title={pd.deleteFromKanban}
        description={pd.confirmDeleteKanban}
        confirmLabel={pd.deleteFromKanban}
        cancelLabel={pd.cancel}
        variant="danger"
        onConfirm={handleDeleteKanban}
        onCancel={() => setConfirmKanban(false)}
      />
    </>
  );
}
