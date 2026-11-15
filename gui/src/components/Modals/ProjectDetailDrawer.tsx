"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ClaudeConfigTab } from "@/components/Modals/ClaudeConfigTab";
import { Drawer } from "@/components/ui/Drawer";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { RingGauge } from "@/components/ui/Meters";
import { StatusPill, STATUS_COLOR, type StatusKind } from "@/components/ui/Pills";
import {
  IconAlert,
  IconArrowUpRight,
  IconBranch,
  IconCoin,
  IconFolder,
  IconGithub,
  IconLock,
  IconRobot,
  IconTrash,
} from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { errorText } from "@/lib/errorText";
import { DetectedBranchNote, detectedBranchOf } from "./DetectedBranchNote";
import { formatUsd } from "@/lib/format";
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
  budgetUsd: string;
}

function makeDraft(p: Project): DraftState {
  return {
    name:          p.name,
    description:   p.description ?? "",
    aiPrompt:      p.aiPrompt ?? "",
    repoPath:      p.repoPath,
    defaultBranch: p.defaultBranch,
    budgetUsd:     p.budgetUsd != null ? String(p.budgetUsd) : "",
  };
}

function draftsEqual(a: DraftState, b: DraftState): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.aiPrompt === b.aiPrompt &&
    a.repoPath === b.repoPath &&
    a.defaultBranch === b.defaultBranch &&
    a.budgetUsd === b.budgetUsd
  );
}

const STAT_KEYS = ["todo", "doing", "review", "done"] as const;

const PLAN_STATUS: Record<string, StatusKind> = {
  planning: "doing",
  done: "done",
  error: "error",
  idle: "nothing",
};

type Tab = "overview" | "claude";

export function ProjectDetailDrawer({ projectId, onClose }: ProjectDetailDrawerProps) {
  const t = useTranslation();
  const pd = t.projectDetail;

  const liveProject   = useBoardStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const gitStatus     = useBoardStore((s) => (projectId ? s.gitStatusByProject[projectId] : undefined));
  const updateProject = useBoardStore((s) => s.updateProject);
  const deleteProject = useBoardStore((s) => s.deleteProject);

  // Keep the last project while the drawer plays its exit animation.
  const lastProject = useRef<Project | null>(null);
  if (liveProject) lastProject.current = liveProject;
  const project = liveProject ?? lastProject.current;

  const open = Boolean(projectId && liveProject);

  const [projectTasks, setProjectTasks] = useState<Task[]>([]);

  const stats = useMemo(() => ({
    todo:   projectTasks.filter((x) => x.status === "todo").length,
    doing:  projectTasks.filter((x) => x.status === "doing").length,
    review: projectTasks.filter((x) => x.status === "review").length,
    done:   projectTasks.filter((x) => x.status === "done").length,
  }), [projectTasks]);

  // Sum of the four lanes, so the rows always add up to the total shown.
  const total = stats.todo + stats.doing + stats.review + stats.done;
  // Same rule as core `projectHasActiveTasks`: a running task, or a Review task
  // whose branch still lives in the repo. Branchless Review rows (seed tasks) don't lock.
  const projectHasActiveTasks = projectTasks.some(
    (x) => x.status === "doing" || (x.status === "review" && Boolean(x.branch)),
  );

  const [activeTab,     setActiveTab]     = useState<Tab>("overview");
  const [draft,         setDraft]         = useState<DraftState | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  /** zincir F0.5: set by a 422 base_branch_missing; null = core found no branch to suggest. */
  const [detectedBranch, setDetectedBranch] = useState<string | null | undefined>(undefined);
  const [confirmKanban, setConfirmKanban] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // "Edit team" (task drawer) lands on Claude Config → Ekip.
  const teamEditorRequest = useBoardStore((s) => s.teamEditorRequest);
  const wantsTeam = !!teamEditorRequest && teamEditorRequest.projectId === projectId;

  useEffect(() => {
    if (liveProject) {
      setDraft(makeDraft(liveProject));
    } else if (!projectId) {
      setDraft(null);
    }
    setError(null);
    setDetectedBranch(undefined);
    setSaving(false);
    setDeleting(false);
    setActiveTab(wantsTeam ? "claude" : "overview");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wantsTeam) setActiveTab("claude");
  }, [wantsTeam]);

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

  const isDirty = useMemo(() => {
    if (!draft || !project) return false;
    return !draftsEqual(draft, makeDraft(project));
  }, [draft, project]);

  const handleSave = async () => {
    if (!project || !draft) return;
    if (!draft.name.trim()) { setError(pd.nameRequired); return; }
    setSaving(true);
    setError(null);
    setDetectedBranch(undefined);
    try {
      const patch: ProjectPatch = {
        name:          draft.name.trim(),
        description:   draft.description || undefined,
        aiPrompt:      draft.aiPrompt || undefined,
        repoPath:      draft.repoPath.trim(),
        defaultBranch: draft.defaultBranch.trim(),
        budgetUsd:     draft.budgetUsd ? parseFloat(draft.budgetUsd) : null,
      };
      const updated = await api.updateProject(project.id, patch);
      updateProject(project.id, updated);
    } catch (err) {
      setError(errorText(t, err, pd.updateFailed));
      setDetectedBranch(detectedBranchOf(err));
    } finally {
      setSaving(false);
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
      setError(errorText(t, err, pd.deleteFailed));
      setDeleting(false);
    }
  };

  if (!project || !draft) return null;

  const planStatus = project.planningStatus && project.planningStatus !== "idle" ? project.planningStatus : null;
  const branch = gitStatus?.branch ?? project.defaultBranch;
  const isClaude = activeTab === "claude";

  const progressBlock = (
    <ProgressBlock stats={stats} total={total} />
  );

  const dangerBlock = (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] leading-snug text-ink-2">{pd.dangerHint}</p>
      <Button
        variant="danger"
        size="sm"
        block
        icon={<IconTrash size={14} />}
        onClick={() => setConfirmKanban(true)}
        loading={deleting}
        className="!justify-start"
      >
        {deleting ? pd.deleting : pd.deleteFromKanban}
      </Button>
    </div>
  );

  const aside = (
    <div className="flex flex-col">
      <section className="ui-meta">
        <p className="t-label !text-[10px]">{pd.progress}</p>
        {progressBlock}
      </section>
      <section className="ui-meta">
        <p className="t-label !text-[10px]">{pd.links}</p>
        {project.remote ? (
          <a href={project.remote} target="_blank" rel="noopener noreferrer" className="ui-linkrow">
            <IconGithub size={15} />
            <span className="min-w-0 flex-1 truncate font-semibold">{pd.openInGithub}</span>
            <IconArrowUpRight size={13} className="text-ink-3" />
          </a>
        ) : (
          <div className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-3 py-2.5 text-[12.5px] leading-snug text-ink-3">
            {pd.noRemote}
          </div>
        )}
        <div className="flex items-center gap-2 font-mono text-[12px] text-ink-2">
          <IconBranch size={13} className="text-ink-3" />
          <span className="truncate">{branch}</span>
          {gitStatus && (
            <span
              className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold"
              style={{ color: gitStatus.isDirty ? "var(--orange-text)" : "var(--green-text)" }}
            >
              <span aria-hidden className="ui-dot !h-2 !w-2" style={{ "--dot": gitStatus.isDirty ? "var(--orange)" : "var(--green)" } as CSSProperties} />
              {gitStatus.isDirty ? t.shell.dirty : t.shell.clean}
            </span>
          )}
        </div>
      </section>
      <section className="ui-meta">
        <p className="t-label !text-[10px] !text-[var(--red-text)]">{pd.dangerZone}</p>
        {dangerBlock}
      </section>
    </div>
  );

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width={isClaude ? "full" : "xl"}
        eyebrow={
          <>
            {project.slug && <span className="ui-keyplate">{project.slug.toLocaleUpperCase("en")}</span>}
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              <IconFolder size={12} />
              <span className="truncate" title={project.repoPath}>{project.repoPath}</span>
            </span>
          </>
        }
        title={project.name}
        meta={
          <>
            {planStatus && (
              <StatusPill status={PLAN_STATUS[planStatus] ?? "info"} live={planStatus === "planning"}>
                {pd.planning[planStatus as keyof typeof pd.planning] ?? planStatus}
              </StatusPill>
            )}
            <StatusPill status="info" icon={<IconBranch size={12} />}>
              <span className="font-mono">{branch}</span>
            </StatusPill>
            {project.remote ? (
              <StatusPill status="info" icon={<IconGithub size={12} />}>
                <span className="max-w-[320px] truncate font-mono">{project.remote.replace(/^(https:\/\/github\.com\/|git@github\.com:)/, "").replace(/\.git$/, "")}</span>
              </StatusPill>
            ) : (
              <StatusPill status="nothing">{pd.localOnly}</StatusPill>
            )}
            <StatusPill status="todo" icon={<IconCoin size={12} />}>
              <span className="font-mono">
                {project.budgetUsd != null ? formatUsd(project.budgetUsd) : pd.budgetDefaultShort}
              </span>
            </StatusPill>
          </>
        }
        tabs={
          <Tabs<Tab>
            label={pd.tabsLabel}
            value={activeTab}
            onChange={setActiveTab}
            className="px-5"
            items={[
              { value: "overview", label: pd.details, icon: <IconFolder size={14} /> },
              { value: "claude", label: t.claudeConfig.tabLabel, icon: <IconRobot size={14} /> },
            ]}
          />
        }
        aside={isClaude ? undefined : aside}
        bodyKey={activeTab}
        bodyClassName={isClaude ? "flex min-h-0 flex-col !overflow-hidden" : undefined}
        footer={
          isClaude ? undefined : (
            <>
              {isDirty && (
                <span className="mr-auto inline-flex items-center gap-2 text-[12.5px] font-semibold text-[var(--orange-text)]">
                  <span aria-hidden className="ui-dot ui-dot--live !h-2 !w-2" style={{ "--dot": "var(--orange)" } as CSSProperties} />
                  {pd.unsaved}
                </span>
              )}
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                {pd.cancel}
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty}>
                {saving ? pd.saving : pd.saveChanges}
              </Button>
            </>
          )
        }
      >
        {isClaude ? (
          <ClaudeConfigTab projectId={project.id} hasRemote={Boolean(project.remote)} />
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-7">
            {error && (
              <div role="alert" className="ui-banner ui-banner--error whitespace-pre-wrap break-words">
                <IconAlert size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Narrow screens: the aside is hidden, so progress lives in the body. */}
            <div className="lg:hidden">{progressBlock}</div>

            {project.planningStatus === "error" && project.planningError && (
              <section>
                <SecHead n={0} label={pd.plannerErrorTitle} tone="var(--red-text)" />
                <pre className="logpane max-h-48 overflow-auto whitespace-pre-wrap break-words !p-3 font-mono text-[11.5px] leading-relaxed text-[var(--red-text)]">
                  {project.planningError}
                </pre>
                <p className="mt-2 text-[12.5px] text-ink-3">{pd.plannerErrorHint}</p>
              </section>
            )}

            <section>
              <SecHead n={1} label={pd.sectionIdentity} />
              <div className="flex flex-col gap-4">
                <Field label={pd.projectName}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder={pd.namePlaceholder}
                    />
                  )}
                </Field>
                <Field label={pd.projectDescription}>
                  {({ id }) => (
                    <Textarea
                      id={id}
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      rows={2}
                      className="resize-y"
                      placeholder={pd.descriptionPlaceholder}
                    />
                  )}
                </Field>
              </div>
            </section>

            <section>
              <SecHead n={2} label={pd.sectionPlanner} />
              <Field label={pd.projectAiPrompt} hint={pd.aiPromptHint}>
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    mono
                    value={draft.aiPrompt}
                    onChange={(e) => setDraft({ ...draft, aiPrompt: e.target.value })}
                    rows={5}
                    className="resize-y"
                    placeholder={pd.aiPromptPlaceholder}
                  />
                )}
              </Field>
            </section>

            <section>
              <SecHead n={3} label={pd.sectionRepo} />
              {projectHasActiveTasks && (
                <div className="ui-banner ui-banner--warn mb-3">
                  <IconLock size={14} className="mt-0.5 shrink-0" />
                  <span>{pd.activeTasksBlockPath}</span>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                <Field label={pd.projectRepoPath}>
                  {({ id }) => (
                    <Input
                      id={id}
                      icon={<IconFolder size={14} />}
                      className="font-mono !text-[13px]"
                      value={draft.repoPath}
                      onChange={(e) => setDraft({ ...draft, repoPath: e.target.value })}
                      disabled={projectHasActiveTasks}
                      placeholder="/path/to/repo"
                    />
                  )}
                </Field>
                <Field
                  label={pd.projectDefaultBranch}
                  error={
                    detectedBranch ? (
                      <DetectedBranchNote
                        detected={detectedBranch}
                        onUse={(b) => {
                          setDraft({ ...draft, defaultBranch: b });
                          setDetectedBranch(undefined);
                          setError(null);
                        }}
                      />
                    ) : undefined
                  }
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={detectedBranch !== undefined}
                      icon={<IconBranch size={14} />}
                      className="font-mono !text-[13px]"
                      value={draft.defaultBranch}
                      onChange={(e) => {
                        setDraft({ ...draft, defaultBranch: e.target.value });
                        setDetectedBranch(undefined);
                      }}
                      disabled={projectHasActiveTasks}
                      placeholder="main"
                    />
                  )}
                </Field>
              </div>
            </section>

            <section>
              <SecHead n={4} label={pd.sectionBudget} />
              <Field label={pd.budgetLabel} hint={pd.budgetHint}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min="0"
                    step="0.5"
                    icon={<IconCoin size={14} />}
                    className="max-w-[220px] font-mono"
                    placeholder={pd.budgetPlaceholder}
                    value={draft.budgetUsd}
                    onChange={(e) => setDraft({ ...draft, budgetUsd: e.target.value })}
                  />
                )}
              </Field>
            </section>

            <section className="lg:hidden">
              <SecHead n={5} label={pd.dangerZone} tone="var(--red-text)" />
              {dangerBlock}
            </section>
          </div>
        )}
      </Drawer>

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

function ProgressBlock({ stats, total }: { stats: Record<(typeof STAT_KEYS)[number], number>; total: number }) {
  const pd = useTranslation().projectDetail;
  return (
    <div className="flex items-center gap-4">
      <RingGauge
        value={stats.done}
        max={Math.max(1, total)}
        size={92}
        thickness={11}
        color="var(--green)"
        ariaLabel={pd.progress}
      >
        {total > 0 ? `${Math.round((stats.done / total) * 100)}%` : "—"}
      </RingGauge>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {STAT_KEYS.map((s) => (
          <li key={s} className="flex items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="ui-dot !h-2.5 !w-2.5"
              style={{ "--dot": STATUS_COLOR[s].fill } as CSSProperties}
            />
            <span className="min-w-0 flex-1 truncate text-ink-2">{pd.stats[s]}</span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">{stats[s]}</span>
          </li>
        ))}
        <li className="mt-0.5 flex items-center gap-2 border-t-2 border-dashed border-hair pt-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1 font-semibold text-ink">{pd.total}</span>
          <span className="font-mono text-[13px] font-bold tabular-nums text-ink">{total}</span>
        </li>
      </ul>
    </div>
  );
}

function SecHead({ n, label, tone }: { n: number; label: ReactNode; tone?: string }) {
  return (
    <header className="ui-sechead">
      <span className="ui-sechead__n">§{String(n).padStart(2, "0")}</span>
      <h3 className="ui-sechead__t" style={tone ? { color: tone } : undefined}>
        {label}
      </h3>
    </header>
  );
}
