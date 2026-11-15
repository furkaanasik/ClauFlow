"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Input, Textarea } from "@/components/ui/Input";
import { DotMeter, RingGauge } from "@/components/ui/Meters";
import { Panel } from "@/components/ui/Panel";
import { PriorityMark, StatusPill, STATUS_COLOR, type StatusKind } from "@/components/ui/Pills";
import {
  IconAlert,
  IconArrowUpRight,
  IconBranch,
  IconChat,
  IconCheck,
  IconClipboard,
  IconCoin,
  IconInfo,
  IconPencil,
  IconPR,
  IconRetry,
  IconRobot,
  IconStop,
  IconSubtask,
  IconTeam,
  IconTerminal,
  IconTrash,
} from "@/components/ui/icons";
import { AgentBadge } from "@/components/Card/AgentBadge";
import { CommentsTab } from "@/components/Card/CommentsTab";
import { LocalChangesTab } from "@/components/Card/LocalChangesTab";
import { LogViewer } from "@/components/Card/LogViewer";
import { TeamTimeline } from "@/components/Card/TeamTimeline";
import { ApprovalGate } from "@/components/Card/ApprovalGate";
import { ToolCallTimeline } from "@/components/Card/ToolCallTimeline";
import { api } from "@/lib/api";
import { apiErrorCode, errorText } from "@/lib/errorText";
import { formatTokens, totalTokens } from "@/lib/cost";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { TeamPicker } from "@/components/Team/TeamPicker";
import { agentStepLabel, teamStepKind } from "@/components/Team/roleMeta";
import { formatUsd, isAgentWorking, taskCost } from "@/lib/boardView";
import type { AgentText, Project, Task, TaskPatch, TeamArtifact, ToolCall } from "@/types";

type EditPriority = "low" | "medium" | "high" | "critical";
type DrawerTab = "details" | "changes" | "log" | "team" | "comments";
type Translations = ReturnType<typeof useTranslation>;

const EMPTY_TOOL_CALLS: ToolCall[] = [];
const EMPTY_AGENT_TEXTS: AgentText[] = [];
/** Executor default when neither task nor project sets a budget (core). */
const DEFAULT_BUDGET_USD = 2;
const ACTIVE_STEPS = ["branching", "running", "pushing", "pr_opening"] as const;

const STATUS_KIND: Record<Task["status"], StatusKind> = {
  todo: "todo",
  doing: "doing",
  review: "review",
  done: "done",
};

interface DraftState {
  title: string;
  description: string;
  analysis: string;
  priority: EditPriority;
  budgetUsd: string;
}

function normalizePriority(p?: string | null): EditPriority {
  const v = (p ?? "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return "medium";
}

function makeDraft(task: Task): DraftState {
  return {
    title: task.title,
    description: task.description ?? "",
    analysis: task.analysis ?? "",
    priority: normalizePriority(task.priority),
    budgetUsd: task.budgetUsd != null ? String(task.budgetUsd) : "",
  };
}

const PRIORITY_BUTTONS: EditPriority[] = ["low", "medium", "high", "critical"];

interface BudgetView {
  /** Latest team run's spend: the budget is per run (§3/9). */
  spent: number;
  limit: number;
  pct: number;
  exceeded: boolean;
  ownBudget: boolean;
  tokens: string | null;
}

export function TaskDetailDrawer() {
  const tt = useTranslation();
  const td = tt.taskDetail;
  const lang = useBoardStore((s) => s.lang);
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const liveTask = useBoardStore((s) => (s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null));
  const projects = useBoardStore((s) => s.projects);
  const selectTask = useBoardStore((s) => s.selectTask);
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const removeTask = useBoardStore((s) => s.removeTask);
  const upsertComment = useBoardStore((s) => s.upsertComment);
  const setToolCalls = useBoardStore((s) => s.setToolCalls);
  const setAgentTexts = useBoardStore((s) => s.setAgentTexts);
  const openTeamEditor = useBoardStore((s) => s.openTeamEditor);
  const upsertNodeRun = useBoardStore((s) => s.upsertNodeRun);
  const setTaskTeam = useBoardStore((s) => s.setTaskTeam);

  // Keep the last task on screen while the drawer plays its exit animation.
  const lastTaskRef = useRef<Task | null>(null);
  if (liveTask) lastTaskRef.current = liveTask;
  const task = liveTask ?? lastTaskRef.current;

  const breakdownStatus = useBoardStore((s) => (task ? s.breakdownStatus[task.id] : undefined));

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("details");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownPrompt, setBreakdownPrompt] = useState("");
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [logView, setLogView] = useState<"raw" | "timeline">("timeline");

  const [teamError, setTeamError] = useState<string | null>(null);

  const open = Boolean(selectedTaskId);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setError(null);
    setSaving(false);
    setDeleting(false);
    setTeamError(null);
    // A run paused at the spec gate needs the user: open straight on the team tab.
    setTab(useBoardStore.getState().tasks[selectedTaskId ?? ""]?.agent.status === "awaiting_approval" ? "team" : "details");
  }, [selectedTaskId]);

  // Refetch on open and whenever the socket (re)connects: events sent while it
  // was down (e.g. boot-time orphan recovery, A8a) never reached the store.
  const wsConnected = useBoardStore((s) => s.wsConnected);
  useEffect(() => {
    if (!selectedTaskId) return;
    api.getComments(selectedTaskId).then((comments) => {
      comments.forEach((c) => upsertComment(c));
    }).catch(() => {});
    api.getToolCalls(selectedTaskId).then((calls) => {
      setToolCalls(selectedTaskId, calls);
    }).catch(() => {});
    api.getAgentTexts(selectedTaskId).then((list) => {
      setAgentTexts(selectedTaskId, list);
    }).catch(() => {});
    api.getTaskTeam(selectedTaskId).then((state) => {
      setTaskTeam(selectedTaskId, state);
    }).catch(() => {});
    api.getNodeRuns(selectedTaskId).then((runs) => {
      for (const run of runs) upsertNodeRun(run);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, wsConnected]);

  const handleTeamChange = async (teamId: string | null) => {
    if (!task) return;
    setTeamError(null);
    try {
      const updated = await api.updateTask(task.id, { teamId });
      upsertTask(updated);
    } catch (err) {
      // server is source of truth — no optimistic update to roll back
      setTeamError(apiErrorCode(err) ? errorText(tt, err) : tt.team.picker.saveError);
    }
  };

  const close = () => {
    if (confirmDelete || confirmAbort) return; // Esc belongs to the dialog
    selectTask(null);
  };

  const beginEdit = () => {
    if (!task) return;
    setDraft(makeDraft(task));
    setEditing(true);
    setError(null);
    setTab("details");
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
    setError(null);
  };

  const saveEdit = async () => {
    if (!task || !draft) return;
    if (!draft.title.trim()) {
      setError(td.errors.titleRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: TaskPatch = {
        title: draft.title.trim(),
        description: draft.description,
        analysis: draft.analysis,
        priority: draft.priority,
        budgetUsd: draft.budgetUsd ? parseFloat(draft.budgetUsd) : null,
      };
      const updated = await api.updateTask(task.id, patch);
      upsertTask(updated);
      setEditing(false);
      setDraft(null);
    } catch (err) {
      setError(errorText(tt, err, td.errors.updateFailed));
    } finally {
      setSaving(false);
    }
  };

  const doRetry = async () => {
    if (!task) return;
    setRetrying(true);
    setError(null);
    try {
      const updated = await api.retryTask(task.id);
      upsertTask(updated);
      setTab("log");
    } catch (err) {
      setError(errorText(tt, err, td.errors.retryFailed));
    } finally {
      setRetrying(false);
    }
  };

  const doAbort = async () => {
    if (!task) return;
    setConfirmAbort(false);
    setAborting(true);
    setError(null);
    try {
      await api.abortTask(task.id);
    } catch (err) {
      setError(errorText(tt, err, td.abortFailed));
    } finally {
      setAborting(false);
    }
  };

  const doBreakdown = async () => {
    if (!task || !breakdownPrompt.trim()) return;
    setBreakdownError(null);
    try {
      await api.breakdownTask(task.id, breakdownPrompt.trim(), 6);
    } catch (err) {
      setBreakdownError(errorText(tt, err, td.breakdownError));
    }
  };

  const doDelete = async () => {
    if (!task) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTask(task.id);
      removeTask(task.id);
      selectTask(null);
    } catch (err) {
      setError(errorText(tt, err, td.errors.deleteFailed));
      setDeleting(false);
    }
  };

  const logs = useMemo(() => task?.agent.log ?? [], [task?.agent.log]);
  const commentCount = task?.comments?.length ?? 0;
  const project = task ? projects.find((p) => p.id === task.projectId) ?? null : null;

  const toolCalls = useBoardStore((s) => (task ? s.toolCalls[task.id] ?? EMPTY_TOOL_CALLS : EMPTY_TOOL_CALLS));
  const agentTexts = useBoardStore((s) => (task ? s.agentTexts[task.id] ?? EMPTY_AGENT_TEXTS : EMPTY_AGENT_TEXTS));
  const allTasks = useBoardStore((s) => s.tasks);
  const subtasks = useMemo(
    () => (task ? Object.values(allTasks).filter((t) => t.parentTaskId === task.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTasks, task?.id],
  );
  const parentTask = useMemo(
    () => (task?.parentTaskId ? allTasks[task.parentTaskId] ?? null : null),
    [allTasks, task?.parentTaskId],
  );
  const budgetExceeded = useBoardStore((s) => s.budgetExceeded);
  const teamArtifactCount = useBoardStore((s) => (task ? s.teamArtifacts[task.id]?.length ?? 0 : 0));
  /** Newest Analyst spec — the Analysis section falls back to it (plan §3/14). */
  const latestSpec = useBoardStore((s) => {
    const list = task ? s.teamArtifacts[task.id] : undefined;
    let latest: TeamArtifact | null = null;
    for (const a of list ?? []) {
      if (a.kind === "spec" && (!latest || a.createdAt >= latest.createdAt)) latest = a;
    }
    return latest;
  });
  const teamQaRound = useBoardStore((s) => {
    const runs = task ? s.teamRuns[task.id] : undefined;
    return runs?.[runs.length - 1]?.qaRound ?? 0;
  });
  const lastRunCost = useBoardStore((s) => {
    const runs = task ? s.teamRuns[task.id] : undefined;
    return runs?.[runs.length - 1]?.costUsd ?? 0;
  });

  const budget = useMemo<BudgetView | null>(() => {
    if (!task) return null;
    const exceeded = budgetExceeded[task.id];
    const total = task.usage ? totalTokens(task.usage) : 0;
    const spent = exceeded?.spentUsd ?? lastRunCost;
    const limit = exceeded?.budgetUsd ?? task.budgetUsd ?? project?.budgetUsd ?? DEFAULT_BUDGET_USD;
    const pct = limit > 0 ? spent / limit : 0;
    return {
      spent,
      limit,
      pct,
      exceeded: Boolean(exceeded) || pct >= 1,
      ownBudget: task.budgetUsd != null,
      tokens: total > 0 ? formatTokens(total) : null,
    };
  }, [task, budgetExceeded, project?.budgetUsd, lastRunCost]);

  if (!task) {
    return null;
  }

  const priority = normalizePriority(task.priority);
  const agentActive = (ACTIVE_STEPS as readonly string[]).includes(task.agent.status);
  const queued = task.status === "doing" && task.agent.status === "idle";
  const awaitingApproval = task.status === "doing" && task.agent.status === "awaiting_approval";
  const showAgentBadge = task.agent.status !== "idle" && (task.status === "doing" || task.agent.status === "error");

  // D1: no PR → the branch is reviewed here, on its local diff.
  const showChanges = Boolean(task.branch) && !task.prNumber && (task.status === "review" || task.status === "done");
  const activeTab: DrawerTab = tab === "changes" && !showChanges ? "details" : tab;

  const tabItems = [
    { value: "details" as const, label: td.tabDetails, icon: <IconInfo size={14} /> },
    ...(showChanges ? [{ value: "changes" as const, label: td.tabChanges, icon: <IconBranch size={14} /> }] : []),
    { value: "log" as const, label: td.tabLog, icon: <IconTerminal size={14} />, count: logs.length || toolCalls.length || undefined },
    { value: "team" as const, label: tt.team.tabTeam, icon: <IconTeam size={14} />, count: teamArtifactCount || undefined },
    { value: "comments" as const, label: td.tabComments, icon: <IconChat size={14} />, count: commentCount || undefined },
  ];

  const meta = (
    <TaskMeta
      task={task}
      project={project}
      editing={editing}
      budget={budget}
      lang={lang}
      t={tt}
      teamError={teamError}
      onTeamChange={handleTeamChange}
    />
  );

  let n = 0;
  const next = () => String(++n).padStart(2, "0");

  return (
    <>
      <Drawer
        open={open}
        onClose={close}
        width="lg"
        ariaLabel={task.title}
        eyebrow={
          <>
            <span className="ui-keyplate">{task.displayId ?? `#${task.id.slice(0, 7)}`}</span>
            {project && (
              <>
                <span className="truncate font-sans text-[13px] font-semibold text-ink-2">{project.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    openTeamEditor(task.projectId, task.teamId ?? project.defaultTeamId ?? null);
                    selectTask(null);
                  }}
                  className="ui-focus inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 font-sans text-[12px] font-semibold text-[var(--cobalt-text)] transition hover:bg-hair"
                >
                  <IconTeam size={12} />
                  {tt.team.editTeam}
                  <IconArrowUpRight size={12} />
                </button>
              </>
            )}
          </>
        }
        title={
          editing && draft ? (
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={td.titlePlaceholder}
              aria-label={td.titlePlaceholder}
              className="!h-11 !text-[18px] !font-bold"
              autoFocus
            />
          ) : (
            task.title
          )
        }
        meta={
          <>
            <StatusPill status={STATUS_KIND[task.status]} variant="solid" live={agentActive} size="md">
              {tt.board.columns[task.status]}
            </StatusPill>
            {!editing && (
              <span className="inline-flex h-[1.875rem] items-center rounded-pill border-2 border-line bg-panel px-2.5">
                <PriorityMark level={priority} label={tt.addTask.priorities[priority]} showLabel />
              </span>
            )}
            {showAgentBadge && <AgentBadge agent={task.agent} taskTitle={task.title} taskId={task.id} />}
            {(budget?.tokens || taskCost(task) !== null) && (
              <span
                title={td.costReported}
                className="inline-flex h-[1.875rem] items-center gap-1.5 rounded-pill border-2 border-line bg-panel px-2.5 font-mono text-[11.5px] font-semibold"
                style={{ color: budget?.exceeded ? "var(--red-text)" : "var(--ink-2)" }}
              >
                <IconCoin size={13} />
                {budget?.tokens && `${budget.tokens} ${td.costTokens} · `}
                {formatUsd(task.costUsd ?? 0)}
              </span>
            )}
            {editing && (
              <StatusPill status="info" variant="solid" icon={<IconPencil size={12} />} size="md">
                {td.editingBadge}
              </StatusPill>
            )}
          </>
        }
        tabs={
          <Tabs
            items={tabItems}
            value={activeTab}
            onChange={setTab}
            label={td.tabsLabel}
            idBase="task-detail"
          />
        }
        aside={meta}
        bodyKey={activeTab}
        bodyClassName={activeTab === "details" ? undefined : "flex flex-col px-5 py-5"}
        footer={
          editing ? (
            <>
              <span className="mr-auto text-[12px] text-ink-3">{td.editingBadge}…</span>
              <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
                {td.cancelButton}
              </Button>
              <Button variant="primary" icon={<IconCheck size={16} />} onClick={saveEdit} loading={saving}>
                {saving ? td.savingButton : td.saveButton}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="danger"
                icon={<IconTrash size={15} />}
                onClick={() => setConfirmDelete(true)}
                loading={deleting}
                className="mr-auto"
              >
                {deleting ? td.deletingButton : td.deleteButton}
              </Button>
              <Button variant="primary" icon={<IconPencil size={15} />} onClick={beginEdit}>
                {td.editButton}
              </Button>
            </>
          )
        }
      >
        <div
          role="tabpanel"
          id={`task-detail-panel-${activeTab}`}
          aria-labelledby={`task-detail-tab-${activeTab}`}
          className={activeTab === "details" ? undefined : "flex min-h-0 flex-1 flex-col"}
        >
          {activeTab === "changes" ? (
            <LocalChangesTab task={task} />
          ) : activeTab === "comments" ? (
            <CommentsTab task={task} />
          ) : activeTab === "team" ? (
            <TeamTimeline task={task} renderApproval={(spec) => <ApprovalGate task={task} spec={spec} />} />
          ) : activeTab === "log" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  size="sm"
                  label={td.logViewLabel}
                  value={logView}
                  onChange={setLogView}
                  options={[
                    { value: "timeline", label: td.toolTimelineTab, count: toolCalls.length || undefined },
                    { value: "raw", label: td.toolRawTab, count: logs.length || undefined },
                  ]}
                />
                {agentActive && (
                  <StatusPill status="doing" live className="ml-auto">
                    {teamStepKind(task.agent.currentStep) ? agentStepLabel(task.agent, tt, teamQaRound) : td.agentStatus[task.agent.status as keyof typeof td.agentStatus] ?? task.agent.status}
                  </StatusPill>
                )}
              </div>

              {queued ? (
                <QueueWaiting label={td.queueWaiting} />
              ) : logView === "timeline" ? (
                <ToolCallTimeline
                  toolCalls={toolCalls}
                  agentTexts={agentTexts}
                  compact
                  emptyMessage={td.toolTimelineEmpty}
                  isAgentRunning={task.status === "doing"}
                  thinkingMessage={td.toolThinking}
                  runStartedAt={task.agent.startedAt}
                  runFinishedAt={task.agent.finishedAt}
                />
              ) : (
                <LogViewer
                  lines={logs}
                  follow
                  live={agentActive}
                  followLabel={td.follow}
                  emptyLabel={td.logsEmpty}
                  ariaLabel={td.toolRawTab}
                  className="min-h-[320px] flex-1"
                />
              )}

              {task.agent.status === "error" && task.agent.error && (
                <div role="alert" className="ui-banner ui-banner--error shrink-0 font-mono text-[12px]">
                  <IconAlert size={15} className="mt-0.5 shrink-0" />
                  <span>
                    <strong className="mr-1.5">{td.logsErrorPrefix}</strong>
                    <span className="whitespace-pre-wrap">{errorText(tt, task.agent.error)}</span>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div>
              {error && (
                <div role="alert" className="ui-banner ui-banner--error mb-5">
                  <IconAlert size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Agent: retry / abort */}
              {task.status === "doing" && (
                <Panel
                  className="mb-7"
                  title={td.agentLabel}
                  icon={<IconRobot size={15} />}
                  meter={
                    queued ? (
                      <StatusPill status="todo">{td.queueWaiting}</StatusPill>
                    ) : awaitingApproval ? (
                      <StatusPill status="review" variant="solid">{tt.team.awaitingApproval}</StatusPill>
                    ) : task.agent.status === "error" ? (
                      <StatusPill status="error" variant="solid">{td.errorOccurred}</StatusPill>
                    ) : (
                      <StatusPill status="doing" live>
                        {teamStepKind(task.agent.currentStep) ? agentStepLabel(task.agent, tt, teamQaRound) : td.agentStatus[task.agent.status as keyof typeof td.agentStatus] ?? task.agent.status}
                      </StatusPill>
                    )
                  }
                  padding="sm"
                >
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {task.agent.status !== "error" && task.agent.status !== "done" && (
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<IconStop size={14} />}
                        onClick={() => setConfirmAbort(true)}
                        loading={aborting}
                      >
                        {aborting ? td.abortingButton : td.abortButton}
                      </Button>
                    )}
                    {awaitingApproval ? (
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<IconClipboard size={14} />}
                        onClick={() => setTab("team")}
                      >
                        {tt.team.approval.review}
                      </Button>
                    ) : (
                      <Button
                        variant={agentActive ? "secondary" : "primary"}
                        size="sm"
                        icon={<IconRetry size={14} />}
                        onClick={doRetry}
                        loading={retrying}
                      >
                        {retrying ? td.retryingButton : agentActive ? td.restartButton : td.retryButton}
                      </Button>
                    )}
                  </div>
                </Panel>
              )}

              {parentTask && (
                <Section n="↑" label={td.parentLabel}>
                  <TaskLinkRow task={parentTask} t={tt} onOpen={() => selectTask(parentTask.id)} />
                </Section>
              )}

              <Section n={next()} label={td.descriptionLabel}>
                {editing && draft ? (
                  <Textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={4}
                    placeholder={td.descriptionPlaceholder}
                    aria-label={td.descriptionLabel}
                    className="resize-y"
                  />
                ) : task.description ? (
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{task.description}</p>
                ) : (
                  <EmptyLine>{td.descriptionEmpty}</EmptyLine>
                )}
              </Section>

              <Section n={next()} label={td.analysisLabel}>
                {editing && draft ? (
                  <Textarea
                    mono
                    value={draft.analysis}
                    onChange={(e) => setDraft({ ...draft, analysis: e.target.value })}
                    rows={9}
                    placeholder={td.analysisPlaceholder}
                    aria-label={td.analysisLabel}
                    className="resize-y"
                  />
                ) : task.analysis ? (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-[12px] border-2 border-line bg-sunken px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-ink">
                    {task.analysis}
                  </pre>
                ) : latestSpec ? (
                  // No hand-written analysis: show the Analyst's latest spec (plan §3/14).
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                        <IconClipboard size={12} />
                        {td.analysisFromSpec}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab("team")}
                        className="ui-focus rounded-[6px] text-[12px] font-semibold text-[var(--cobalt-text)] underline underline-offset-2"
                      >
                        {td.analysisOpenTeam}
                      </button>
                    </div>
                    <div className="comment-markdown max-h-80 overflow-auto rounded-[12px] border-2 border-line bg-sunken px-4 py-3.5 text-[13.5px] leading-relaxed text-ink">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestSpec.body}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <EmptyLine>
                    {td.analysisEmpty}{" "}
                    <button
                      type="button"
                      onClick={() => setTab("team")}
                      className="ui-focus rounded-[4px] font-semibold not-italic text-[var(--cobalt-text)] underline underline-offset-2"
                    >
                      {td.analysisOpenTeam}
                    </button>
                  </EmptyLine>
                )}
              </Section>

              {editing && draft && (
                <>
                  <Section n={next()} label={td.priorityLabel}>
                    <Segmented
                      label={td.priorityLabel}
                      value={draft.priority}
                      onChange={(v) => setDraft({ ...draft, priority: v })}
                      options={PRIORITY_BUTTONS.map((value) => ({
                        value,
                        label: tt.addTask.priorities[value],
                        icon: <PriorityMark level={value} label={tt.addTask.priorities[value]} />,
                      }))}
                    />
                  </Section>
                  <Section n={next()} label={td.budgetLabel}>
                    <div className="flex max-w-xs flex-col gap-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        icon={<span className="font-mono text-[13px] font-bold">$</span>}
                        placeholder={td.budgetInputPlaceholder.replace(
                          "{v}",
                          (task.budgetUsd ?? project?.budgetUsd ?? DEFAULT_BUDGET_USD).toFixed(2),
                        )}
                        value={draft.budgetUsd}
                        onChange={(e) => setDraft({ ...draft, budgetUsd: e.target.value })}
                        aria-label={td.budgetLabel}
                        className="font-mono"
                      />
                      <p className="text-xs text-ink-3">{td.budgetHint}</p>
                    </div>
                  </Section>
                </>
              )}

              {!editing && subtasks.length > 0 && (
                <Section
                  n={next()}
                  label={td.subtasksLabel}
                  trailing={
                    <span className="flex items-center gap-2 font-mono text-[11px] font-semibold text-ink-3">
                      <DotMeter
                        size="sm"
                        value={subtasks.filter((s) => s.status === "done").length}
                        max={subtasks.length}
                        color="var(--green)"
                        label={td.subtasksLabel}
                      />
                      {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
                    </span>
                  }
                >
                  <ul className="flex flex-col gap-2">
                    {subtasks.map((sub) => (
                      <li key={sub.id}>
                        <TaskLinkRow task={sub} t={tt} onOpen={() => selectTask(sub.id)} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Below lg the split aside is hidden, so its sections move inline */}
              <div className="mb-7 rounded-[14px] border-2 border-line bg-panel p-4 lg:hidden">{meta}</div>

              {!editing && task.status !== "done" && task.status !== "doing" && (
                <div className="mb-2">
                  {!showBreakdown ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowBreakdown(true);
                        setBreakdownPrompt([task.title, task.description, task.analysis].filter(Boolean).join("\n\n"));
                      }}
                      className="ui-focus group flex w-full items-center gap-3 rounded-[12px] border-2 border-dashed border-line px-4 py-3 text-left transition hover:border-solid hover:bg-panel hover:shadow-hard"
                    >
                      <span
                        aria-hidden
                        className="grid h-8 w-8 place-items-center rounded-[9px] border-2 border-line bg-sunken text-ink-2 transition group-hover:bg-mustard group-hover:text-[var(--on-mustard)]"
                      >
                        <IconSubtask size={15} />
                      </span>
                      <span className="text-[13.5px] font-semibold text-ink">{td.breakdownLabel}</span>
                      <IconArrowUpRight size={14} className="ml-auto text-ink-3" />
                    </button>
                  ) : (
                    <Panel title={td.breakdownLabel} icon={<IconSubtask size={15} />} padding="sm">
                      <div className="flex flex-col gap-2.5">
                        <Textarea
                          mono
                          value={breakdownPrompt}
                          onChange={(e) => setBreakdownPrompt(e.target.value)}
                          rows={5}
                          disabled={breakdownStatus === "breaking"}
                          placeholder={td.breakdownPromptPlaceholder}
                          aria-label={td.breakdownLabel}
                          className="resize-y"
                        />
                        {breakdownError && (
                          <p role="alert" className="ui-banner ui-banner--error">{breakdownError}</p>
                        )}
                        {breakdownStatus === "done" && (
                          <StatusPill status="done" icon={<IconCheck size={12} />} className="self-start">
                            {td.breakdownDone}
                          </StatusPill>
                        )}
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowBreakdown(false);
                              setBreakdownError(null);
                            }}
                          >
                            {td.breakdownCancel}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<IconSubtask size={14} />}
                            onClick={doBreakdown}
                            loading={breakdownStatus === "breaking"}
                            disabled={!breakdownPrompt.trim()}
                          >
                            {breakdownStatus === "breaking" ? td.breakdowning : td.breakdownButton}
                          </Button>
                        </div>
                      </div>
                    </Panel>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title={td.confirmDelete.title}
        description={td.confirmDelete.description}
        confirmLabel={td.confirmDelete.confirm}
        cancelLabel={td.confirmDelete.cancel}
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmAbort}
        title={td.confirmAbort.title}
        description={td.confirmAbort.description}
        confirmLabel={td.confirmAbort.confirm}
        cancelLabel={td.confirmDelete.cancel}
        variant="danger"
        onConfirm={doAbort}
        onCancel={() => setConfirmAbort(false)}
      />
    </>
  );
}

/* ─── Split-pane meta column ─────────────────────────────────────────────── */

function TaskMeta({
  task,
  project,
  editing,
  budget,
  lang,
  t,
  teamError,
  onTeamChange,
}: {
  task: Task;
  project: Project | null;
  editing: boolean;
  budget: BudgetView | null;
  lang: string;
  t: Translations;
  teamError: string | null;
  onTeamChange: (teamId: string | null) => void;
}) {
  const td = t.taskDetail;
  // The team is fixed once the task is picked up (queued, running or paused at the
  // gate) and once it is done (core answers 409 task_done).
  const teamLocked = task.status === "doing" || task.status === "done" || isAgentWorking(task);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "tr-TR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const gaugeColor = !budget
    ? "var(--green)"
    : budget.exceeded
      ? "var(--red)"
      : budget.pct >= 0.9
        ? "var(--orange)"
        : budget.pct >= 0.6
          ? "var(--mustard)"
          : "var(--green)";

  return (
    <div className="flex flex-col">
      {/* Budget */}
      {budget && (
        <div className="ui-meta">
          <MetaLabel icon={<IconCoin size={12} />}>
            {td.budgetLabel} · {td.budgetThisRun}
          </MetaLabel>
          <div className="flex items-center gap-4">
            <RingGauge
              value={Math.min(budget.spent, budget.limit)}
              max={budget.limit}
              size={84}
              thickness={9}
              color={gaugeColor}
              ariaLabel={td.budgetUsed}
            >
              <span className="text-[15px]">{Math.round(budget.pct * 100)}%</span>
            </RingGauge>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[20px] font-bold leading-none tracking-tight text-ink">
                ${budget.spent.toFixed(2)}
              </div>
              <div className="mt-1 font-mono text-[11.5px] text-ink-3">
                / ${budget.limit.toFixed(2)} {td.budgetLimit.toLowerCase()}
              </div>
              <DotMeter
                className="mt-2.5"
                size="sm"
                max={10}
                value={budget.spent > 0 ? Math.max(1, budget.pct * 10) : 0}
                color={gaugeColor}
                label={td.budgetUsed}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
            {budget.exceeded ? (
              <StatusPill status="error" variant="solid" icon={<IconAlert size={12} />}>
                {td.budgetExceeded}
              </StatusPill>
            ) : (
              <span>
                {budget.ownBudget
                  ? td.budgetPerTask.replace("{v}", `$${budget.limit.toFixed(2)}`)
                  : td.budgetProjectDefault}
                {budget.spent === 0 && <span className="text-ink-3"> · {td.budgetNoUsage}</span>}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Team: "who does this task?" */}
      {!editing && project && (
        <div className="ui-meta">
          <MetaLabel icon={<IconTeam size={12} />}>{t.team.picker.label}</MetaLabel>
          <TeamPicker
            project={project}
            value={task.teamId ?? null}
            onChange={onTeamChange}
            locked={teamLocked}
            lockedReason={task.status === "done" ? t.team.picker.lockedDone : undefined}
            refreshKey={task.id}
            hideLabel
            error={teamError}
          />
        </div>
      )}

      {/* Links */}
      <div className="ui-meta">
        <MetaLabel icon={<IconBranch size={12} />}>{td.connectionsLabel}</MetaLabel>
        {!task.branch && !task.prUrl && <p className="text-[12px] text-ink-3">{td.noLinks}</p>}
        {task.branch && (
          <code
            title={task.branch}
            className="flex items-center gap-1.5 truncate rounded-[8px] border-2 border-line bg-sunken px-2 py-1.5 font-mono text-[11.5px] text-ink"
          >
            <IconBranch size={13} className="shrink-0 text-ink-3" />
            <span className="truncate">{task.branch}</span>
          </code>
        )}
        {task.prUrl && (
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-btn ui-btn--secondary ui-btn--sm ui-focus !justify-start"
          >
            <IconPR size={14} />
            <span className="min-w-0 flex-1 truncate text-left">
              {td.openPr} {task.prNumber ? `#${task.prNumber}` : ""}
            </span>
            <IconArrowUpRight size={13} />
          </a>
        )}
        {task.prUrl && task.status === "done" && (
          <StatusPill status="done" className="self-start">{td.merged}</StatusPill>
        )}
        {task.prUrl && task.agent.status === "error" && task.status !== "done" && (
          <StatusPill status="error" className="self-start">{td.mergeError}</StatusPill>
        )}
      </div>

      {/* Dates */}
      <div className="ui-meta">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-3">{td.createdLabel}</dt>
          <dd className="text-right font-mono text-ink-2">{fmt(task.createdAt)}</dd>
          <dt className="text-ink-3">{td.updatedLabel}</dt>
          <dd className="text-right font-mono text-ink-2">{fmt(task.updatedAt)}</dd>
          {project && (
            <>
              <dt className="text-ink-3">{td.projectLabel}</dt>
              <dd className="truncate text-right font-medium text-ink-2">{project.name}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

/* ─── Small pieces ───────────────────────────────────────────────────────── */

function MetaLabel({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="t-label flex items-center gap-1.5 !text-ink-2">
      {icon}
      {children}
    </span>
  );
}

function Section({
  n,
  label,
  trailing,
  children,
}: {
  n: string;
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      <header className="ui-sechead">
        <span className="ui-sechead__n">§{n}</span>
        <h3 className="ui-sechead__t">{label}</h3>
        {trailing && <span className="order-last">{trailing}</span>}
      </header>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-3 py-2.5 text-[13px] italic text-ink-3">
      {children}
    </p>
  );
}

function TaskLinkRow({ task, t, onOpen }: { task: Task; t: Translations; onOpen: () => void }) {
  const kind = STATUS_KIND[task.status];
  return (
    <button type="button" onClick={onOpen} className="ui-linkrow">
      <span aria-hidden className="ui-dot" style={{ "--dot": STATUS_COLOR[kind].fill } as CSSProperties} />
      {task.displayId && <span className="shrink-0 font-mono text-[11px] font-bold text-ink-3">{task.displayId}</span>}
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{task.title}</span>
      <StatusPill status={kind} className="shrink-0 !h-5 !text-[11px]">
        {t.board.columns[task.status]}
      </StatusPill>
    </button>
  );
}

function QueueWaiting({ label }: { label: string }) {
  return (
    <div className="ui-hatch flex flex-1 flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-line py-14">
      <span className="flex gap-1.5" aria-hidden>
        <span className="animate-dot-1 h-2 w-2 rounded-full bg-ink-3" />
        <span className="animate-dot-2 h-2 w-2 rounded-full bg-ink-3" />
        <span className="animate-dot-3 h-2 w-2 rounded-full bg-ink-3" />
      </span>
      <span className="t-display text-[18px] text-ink-2">{label}</span>
    </div>
  );
}
