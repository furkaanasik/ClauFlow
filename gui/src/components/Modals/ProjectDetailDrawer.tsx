"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { Project, ProjectPatch, Task, TaskStatus } from "@/types";

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
    a.name === b.name &&
    a.description === b.description &&
    a.aiPrompt === b.aiPrompt &&
    a.repoPath === b.repoPath &&
    a.defaultBranch === b.defaultBranch
  );
}

const STATUS_INK: Record<TaskStatus, string> = {
  todo:   "var(--status-todo)",
  doing:  "var(--status-doing)",
  review: "var(--status-review)",
  done:   "var(--status-done)",
};

const PLAN_INK: Record<string, string> = {
  planning: "var(--status-warning)",
  done:     "var(--accent-primary)",
  error:    "var(--status-error)",
  idle:     "var(--text-muted)",
};

export function ProjectDetailDrawer({ projectId, onClose }: ProjectDetailDrawerProps) {
  const t = useTranslation();
  const pd = t.projectDetail;

  const project       = useBoardStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const updateProject = useBoardStore((s) => s.updateProject);
  const deleteProject = useBoardStore((s) => s.deleteProject);

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
    if (!draft.name.trim()) { setError("Project name required."); return; }
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
      setError(err instanceof Error ? err.message : "Update failed.");
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
      setError(err instanceof Error ? err.message : "Delete failed.");
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
      setError(err instanceof Error ? err.message : "Delete failed.");
      setDeleting(false);
    }
  };

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/65 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={clsx(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--border)] bg-[var(--bg-base)] shadow-2xl",
          "transform transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
      >
        {project && draft ? (
          <>
            <header className="border-b border-[var(--border)] px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="t-display text-3xl leading-[1.1] text-[var(--text-primary)]">
                    {project.name}
                  </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {project.planningStatus && project.planningStatus !== "idle" && (
                      <span
                        className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium capitalize"
                        style={{
                          borderColor: PLAN_INK[project.planningStatus],
                          color: PLAN_INK[project.planningStatus],
                        }}
                      >
                        <span
                          className="h-1 w-1"
                          style={{ background: PLAN_INK[project.planningStatus] }}
                        />
                        {project.planningStatus}
                      </span>
                    )}
                    {project.remote && (
                      <span className="truncate font-mono text-[11px] text-[var(--text-faint)]">
                        {project.remote}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 border border-[var(--border)] p-2 text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  aria-label="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 1l12 12M13 1L1 13" />
                  </svg>
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {error && (
                <div className="mb-4 whitespace-pre-wrap break-words border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-xs text-[var(--status-error)]">
                  {error}
                </div>
              )}

              {/* Stats */}
              <Section label={pd.progress}>
                <div className="grid grid-cols-4 gap-px border border-[var(--border)] bg-[var(--border)]">
                  {(["todo", "doing", "review", "done"] as const).map((s) => (
                    <div
                      key={s}
                      className="flex flex-col gap-1 bg-[var(--bg-surface)] px-3 py-3"
                    >
                      <span
                        className="text-[11px] font-medium capitalize"
                        style={{ color: STATUS_INK[s] }}
                      >
                        {pd.stats[s]}
                      </span>
                      <span
                        className="font-mono text-2xl font-semibold tabular-nums"
                        style={{ color: STATUS_INK[s] }}
                      >
                        {stats[s]}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-[var(--text-muted)]">Progress</span>
                    <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                      {donePercent}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden bg-[var(--bg-sunken)]">
                    <div
                      className="h-full bg-[var(--accent-primary)] transition-all duration-500"
                      style={{ width: `${donePercent}%` }}
                    />
                  </div>
                </div>
              </Section>

              {project.planningStatus === "error" && project.planningError && (
                <Section label={pd.plannerErrorTitle} tone="var(--status-error)">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border border-[var(--status-error)] bg-[var(--status-error-ink)] p-3 font-mono text-[11px] leading-relaxed text-[var(--status-error)]">
                    {project.planningError}
                  </pre>
                  <p className="mt-2 text-xs italic text-[var(--text-muted)]">{pd.plannerErrorHint}</p>
                </Section>
              )}

              <Section label={pd.details}>
                <div className="flex flex-col gap-4">
                  <Field label={pd.projectName}>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className={inputCls}
                      placeholder="Project name"
                    />
                  </Field>

                  <Field label={pd.projectDescription}>
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      rows={2}
                      className={clsx(inputCls, "resize-y")}
                      placeholder="Short description…"
                    />
                  </Field>

                  <Field label={pd.projectAiPrompt}>
                    <textarea
                      value={draft.aiPrompt}
                      onChange={(e) => setDraft({ ...draft, aiPrompt: e.target.value })}
                      rows={5}
                      className={clsx(inputCls, "resize-y font-mono text-xs")}
                      placeholder="Describe the project; the planner will split it into tasks…"
                    />
                  </Field>

                  <Field label={pd.projectRepoPath}>
                    <input
                      type="text"
                      value={draft.repoPath}
                      onChange={(e) => setDraft({ ...draft, repoPath: e.target.value })}
                      disabled={projectHasActiveTasks}
                      className={clsx(
                        inputCls,
                        "font-mono",
                        projectHasActiveTasks && "cursor-not-allowed opacity-50",
                      )}
                      placeholder="/path/to/repo"
                    />
                    {projectHasActiveTasks && (
                      <p className="text-[11px] text-[var(--text-faint)]">
                        {pd.activeTasksBlockPath}
                      </p>
                    )}
                  </Field>

                  <Field label={pd.projectDefaultBranch}>
                    <input
                      type="text"
                      value={draft.defaultBranch}
                      onChange={(e) => setDraft({ ...draft, defaultBranch: e.target.value })}
                      disabled={projectHasActiveTasks}
                      className={clsx(
                        inputCls,
                        "font-mono",
                        projectHasActiveTasks && "cursor-not-allowed opacity-50",
                      )}
                      placeholder="main"
                    />
                    {projectHasActiveTasks && (
                      <p className="text-[11px] text-[var(--text-faint)]">
                        {pd.activeTasksBlockPath}
                      </p>
                    )}
                  </Field>
                </div>
              </Section>

              {project.remote && (
                <Section label="External">
                  <a
                    href={project.remote}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--accent-primary)] transition hover:border-[var(--accent-primary)]"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    {pd.openInGithub} ↗
                  </a>
                </Section>
              )}

              {/* Danger Zone */}
              <Section label={pd.dangerZone} tone="var(--status-error)">
                <div className="flex flex-col gap-2">
                  {project.remote && (
                    <button
                      type="button"
                      onClick={() => setConfirmGithub(true)}
                      disabled={deleting}
                      className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-4 py-2 text-left text-[12px] font-medium text-[var(--status-error)] transition hover:bg-[var(--status-error)] hover:text-[var(--bg-base)] disabled:opacity-50"
                    >
                      {deleting ? pd.deleting : pd.deleteFromGithub}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmKanban(true)}
                    disabled={deleting}
                    className="border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-left text-[12px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--status-error)] hover:text-[var(--status-error)] disabled:opacity-50"
                  >
                    {deleting ? pd.deleting : pd.deleteFromKanban}
                  </button>
                </div>
              </Section>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn-ghost px-4 py-2 text-[12px] font-medium"
              >
                {pd.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="btn-ink px-4 py-2 text-[12px] font-medium disabled:opacity-50"
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

const inputCls =
  "w-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition focus:border-[var(--text-secondary)]";

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <header className="mb-3">
        <span
          className="text-[12px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: tone ?? "var(--text-muted)" }}
        >
          {label}
        </span>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}
