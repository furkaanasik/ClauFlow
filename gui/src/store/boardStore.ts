import { create } from "zustand";
import type { AgentStatus, AgentText, CloneStatus, Comment, GitStatus, NodeRun, StashEntry, ProjectPlanningStatus, Project, ProjectPatch, Task, TaskPatch, TaskTeamState, Team, TeamArtifact, TeamRun, ToolCall } from "@/types";
import { mergeById, newerAgentText, newerTeamArtifact, newerTeamRun, newerToolCall } from "./mergeById";

type Lang = "tr" | "en";

function getInitialLang(): Lang {
  return "tr";
}

interface BoardState {
  tasks: Record<string, Task>;
  order: string[];
  projects: Project[];
  /** Client clock (ms) when this tab saw `project_planning_started`, per project. */
  planningStartedAt: Record<string, number>;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  selectedPRTaskId: string | null;
  wsConnected: boolean;
  filterText: string;
  lang: Lang;
  /** IDs of tasks recently added via WS — used to trigger drop animation */
  newTaskIds: Set<string>;
  /** Tool calls per task, keyed by taskId */
  toolCalls: Record<string, ToolCall[]>;
  /** Agent narrative texts per task, keyed by taskId */
  agentTexts: Record<string, AgentText[]>;
  /** Clone progress per targetPath */
  cloneStatus: Record<string, { status: CloneStatus; message: string }>;
  /** Node runs per task, keyed by taskId then nodeId — last-write-wins */
  nodeRuns: Record<string, Record<string, NodeRun>>;
  budgetExceeded: Record<string, { spentUsd: number; budgetUsd: number }>;
  gitStatusByProject: Record<string, GitStatus>;
  /** zincir E6: ClauFlow's stashes per project (newest first) and their count. */
  stashesByProject: Record<string, StashEntry[]>;
  stashCountByProject: Record<string, number>;
  projectDetailRequest: string | null;
  /** "Edit team" intent from the task drawer: AppRail opens the project drawer on
   *  Claude Config → Ekip, with `teamId` (the task's team) preselected when given. */
  teamEditorRequest: { projectId: string; teamId: string | null } | null;

  /** Teams usable by a project (built-ins, user templates, project teams), keyed by projectId. */
  teamsByProject: Record<string, Team[]>;
  /** Team runs per task, oldest first. */
  teamRuns: Record<string, TeamRun[]>;
  /** Team artifacts per task, in creation order. */
  teamArtifacts: Record<string, TeamArtifact[]>;

  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: string) => void;

  patchTaskLocal: (id: string, patch: Partial<Task> | TaskPatch) => Task | undefined;
  rollbackTask: (id: string, previous: Task) => void;

  appendLog: (taskId: string, line: string) => void;
  setAgentStatus: (
    taskId: string,
    payload: { status: AgentStatus; currentStep?: string },
  ) => void;
  appendToolCall: (taskId: string, toolCall: ToolCall) => void;
  setToolCalls: (taskId: string, calls: ToolCall[]) => void;
  appendAgentText: (taskId: string, agentText: AgentText) => void;
  setAgentTexts: (taskId: string, list: AgentText[]) => void;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, patch: ProjectPatch) => void;
  deleteProject: (id: string) => void;
  addTask: (task: Task) => void;
  selectProject: (id: string | null) => void;
  updateProjectPlanningStatus: (projectId: string, status: ProjectPlanningStatus, error?: string) => void;

  selectTask: (id: string | null) => void;
  selectPRTask: (id: string | null) => void;

  upsertComment: (comment: Comment) => void;

  setWsConnected: (connected: boolean) => void;
  setFilterText: (text: string) => void;
  setLang: (lang: Lang) => void;
  clearNewTaskId: (id: string) => void;

  setCloneProgress: (targetPath: string, message: string) => void;
  completeClone: (targetPath: string, project?: Project) => void;
  failClone: (targetPath: string, message: string) => void;

  upsertNodeRun: (run: NodeRun) => void;

  setBudgetExceeded: (taskId: string, payload: { spentUsd: number; budgetUsd: number }) => void;
  clearBudgetExceeded: (taskId: string) => void;
  setProjectGitStatus: (projectId: string, status: GitStatus) => void;
  setProjectStashes: (projectId: string, stashes: StashEntry[]) => void;

  breakdownStatus: Record<string, "breaking" | "done" | "error">;
  setBreakdownStatus: (taskId: string, status: "breaking" | "done" | "error") => void;

  openProjectDetail: (projectId: string) => void;
  clearProjectDetailRequest: () => void;
  openTeamEditor: (projectId: string, teamId?: string | null) => void;
  closeTeamEditor: () => void;

  setTeams: (projectId: string, teams: Team[]) => void;
  setTaskTeam: (taskId: string, state: TaskTeamState) => void;
  upsertTeamRun: (run: TeamRun) => void;
  upsertTeamArtifact: (artifact: TeamArtifact) => void;

}

const LOG_LIMIT = 500;

/** Replace the item with the same id in place, or append it. */
function upsertById<T extends { id: string }>(list: T[] | undefined, item: T): T[] {
  const existing = list ?? [];
  const idx = existing.findIndex((x) => x.id === item.id);
  return idx >= 0 ? [...existing.slice(0, idx), item, ...existing.slice(idx + 1)] : [...existing, item];
}

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: {},
  order: [],
  projects: [],
  planningStartedAt: {},
  selectedProjectId: null,
  selectedTaskId: null,
  selectedPRTaskId: null,
  wsConnected: false,
  filterText: "",
  lang: getInitialLang(),
  newTaskIds: new Set<string>(),
  toolCalls: {},
  agentTexts: {},
  cloneStatus: {},
  nodeRuns: {},
  budgetExceeded: {},
  gitStatusByProject: {},
  stashesByProject: {},
  stashCountByProject: {},
  breakdownStatus: {},
  projectDetailRequest: null,
  teamEditorRequest: null,
  teamsByProject: {},
  teamRuns: {},
  teamArtifacts: {},

  setTasks: (tasks) =>
    set(() => ({
      tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
      order: tasks.map((t) => t.id),
    })),

  upsertTask: (task) =>
    set((state) => {
      if (
        state.selectedProjectId &&
        task.projectId !== state.selectedProjectId
      ) {
        return state;
      }
      const order = state.order.includes(task.id)
        ? state.order
        : [...state.order, task.id];
      const existing = state.tasks[task.id];
      const incomingLog = task.agent?.log ?? [];
      const existingLog = existing?.agent?.log ?? [];
      const merged: Task =
        existing && incomingLog.length === 0 && existingLog.length > 0
          ? { ...task, agent: { ...task.agent, log: existingLog } }
          : task;
      return {
        tasks: { ...state.tasks, [task.id]: merged },
        order,
      };
    }),

  removeTask: (id) =>
    set((state) => {
      if (!state.tasks[id]) return state;
      const { [id]: _removed, ...rest } = state.tasks;
      void _removed;
      return {
        tasks: rest,
        order: state.order.filter((x) => x !== id),
        selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
      };
    }),

  patchTaskLocal: (id, patch) => {
    const existing = get().tasks[id];
    if (!existing) return undefined;
    const { agent: agentPatch, ...rest } = patch as TaskPatch;
    const next: Task = {
      ...existing,
      ...rest,
      agent: agentPatch
        ? { ...existing.agent, ...agentPatch, status: agentPatch.status ?? existing.agent.status }
        : existing.agent,
      updatedAt: new Date().toISOString(),
    };
    set((state) => ({ tasks: { ...state.tasks, [id]: next } }));
    return existing;
  },

  rollbackTask: (id, previous) =>
    set((state) => ({ tasks: { ...state.tasks, [id]: previous } })),

  appendLog: (taskId, line) =>
    set((state) => {
      const t = state.tasks[taskId];
      if (!t) return state;
      const nextLog = [...(t.agent.log ?? []), line].slice(-LOG_LIMIT);
      const agent = { ...t.agent, log: nextLog };
      return { tasks: { ...state.tasks, [taskId]: { ...t, agent } } };
    }),

  setAgentStatus: (taskId, payload) =>
    set((state) => {
      const t = state.tasks[taskId];
      if (!t) return state;
      const agent = {
        ...t.agent,
        status: payload.status,
        currentStep: payload.currentStep ?? t.agent.currentStep,
      };
      return { tasks: { ...state.tasks, [taskId]: { ...t, agent } } };
    }),

  appendToolCall: (taskId, toolCall) =>
    set((state) => {
      const existing = state.toolCalls[taskId] ?? [];
      // If already exists with same id, update it; otherwise append
      const idx = existing.findIndex((tc) => tc.id === toolCall.id);
      const next =
        idx >= 0
          ? [...existing.slice(0, idx), toolCall, ...existing.slice(idx + 1)]
          : [...existing, toolCall];
      return { toolCalls: { ...state.toolCalls, [taskId]: next } };
    }),

  setToolCalls: (taskId, calls) =>
    set((state) => ({
      toolCalls: {
        ...state.toolCalls,
        [taskId]: mergeById(state.toolCalls[taskId], calls, (c) => c.id, newerToolCall),
      },
    })),

  appendAgentText: (taskId, agentText) =>
    set((state) => {
      const existing = state.agentTexts[taskId] ?? [];
      // id-based dedupe: if already exists, update; otherwise append
      const idx = existing.findIndex((t) => t.id === agentText.id);
      const next =
        idx >= 0
          ? [...existing.slice(0, idx), agentText, ...existing.slice(idx + 1)]
          : [...existing, agentText];
      return { agentTexts: { ...state.agentTexts, [taskId]: next } };
    }),

  setAgentTexts: (taskId, list) =>
    set((state) => ({
      agentTexts: {
        ...state.agentTexts,
        [taskId]: mergeById(state.agentTexts[taskId], list, (x) => x.id, newerAgentText),
      },
    })),

  upsertComment: (comment) =>
    set((state) => {
      const task = state.tasks[comment.taskId];
      if (!task) return state;
      const existing = task.comments ?? [];
      const idx = existing.findIndex((c) => c.id === comment.id);
      const updated =
        idx >= 0
          ? [...existing.slice(0, idx), comment, ...existing.slice(idx + 1)]
          : [...existing, comment];
      return {
        tasks: {
          ...state.tasks,
          [comment.taskId]: { ...task, comments: updated },
        },
      };
    }),

  setProjects: (projects) => set(() => ({ projects })),

  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),

  updateProject: (id, patch) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    })),

  deleteProject: (id) =>
    set((state) => {
      const taskIds = Object.values(state.tasks)
        .filter((t) => t.projectId === id)
        .map((t) => t.id);
      const tasks = { ...state.tasks };
      for (const tid of taskIds) delete tasks[tid];
      const order = state.order.filter((x) => !taskIds.includes(x));
      return {
        projects: state.projects.filter((p) => p.id !== id),
        tasks,
        order,
        selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
        selectedTaskId: taskIds.includes(state.selectedTaskId ?? "") ? null : state.selectedTaskId,
      };
    }),

  addTask: (task) =>
    set((state) => {
      // Skip if task already exists (duplicate check)
      if (state.tasks[task.id]) return state;
      // Skip if task belongs to a different project
      if (state.selectedProjectId && task.projectId !== state.selectedProjectId) {
        return state;
      }
      const newTaskIds = new Set(state.newTaskIds);
      newTaskIds.add(task.id);
      return {
        tasks: { ...state.tasks, [task.id]: task },
        order: [...state.order, task.id],
        newTaskIds,
      };
    }),

  updateProjectPlanningStatus: (projectId, status, error) =>
    set((state) => {
      const planningStartedAt = { ...state.planningStartedAt };
      if (status === "planning") planningStartedAt[projectId] = Date.now();
      else delete planningStartedAt[projectId];
      return {
        projects: state.projects.map((p) =>
          p.id === projectId
            ? { ...p, planningStatus: status, planningError: error ?? null }
            : p,
        ),
        planningStartedAt,
      };
    }),

  selectProject: (id) =>
    set((state) => {
      if (state.selectedProjectId === id) return state;
      return {
        selectedProjectId: id,
        tasks: {},
        order: [],
        selectedTaskId: null,
      };
    }),

  selectTask: (id) => set(() => ({ selectedTaskId: id })),

  selectPRTask: (id) => set(() => ({ selectedPRTaskId: id })),

  clearNewTaskId: (id) =>
    set((state) => {
      if (!state.newTaskIds.has(id)) return state;
      const newTaskIds = new Set(state.newTaskIds);
      newTaskIds.delete(id);
      return { newTaskIds };
    }),

  setCloneProgress: (targetPath, message) =>
    set((state) => ({
      cloneStatus: { ...state.cloneStatus, [targetPath]: { status: "cloning", message } },
    })),

  completeClone: (targetPath, project) =>
    set((state) => {
      const next: BoardState["cloneStatus"] = {
        ...state.cloneStatus,
        [targetPath]: { status: "done", message: "" },
      };
      if (project) {
        return {
          cloneStatus: next,
          projects: [...state.projects, project],
          selectedProjectId: project.id,
        };
      }
      return { cloneStatus: next };
    }),

  failClone: (targetPath, message) =>
    set((state) => ({
      cloneStatus: { ...state.cloneStatus, [targetPath]: { status: "error", message } },
    })),

  upsertNodeRun: (run) =>
    set((state) => ({
      nodeRuns: {
        ...state.nodeRuns,
        [run.taskId]: {
          ...(state.nodeRuns[run.taskId] ?? {}),
          [run.nodeId]: run,
        },
      },
    })),

  setBudgetExceeded: (taskId, payload) =>
    set((state) => ({
      budgetExceeded: { ...state.budgetExceeded, [taskId]: payload },
    })),

  clearBudgetExceeded: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...rest } = state.budgetExceeded;
      void _;
      return { budgetExceeded: rest };
    }),

  setProjectGitStatus: (projectId, status) =>
    set((state) => ({
      gitStatusByProject: { ...state.gitStatusByProject, [projectId]: status },
    })),

  setProjectStashes: (projectId, stashes) =>
    set((state) => ({
      stashesByProject: { ...state.stashesByProject, [projectId]: stashes },
      stashCountByProject: { ...state.stashCountByProject, [projectId]: stashes.length },
    })),

  setBreakdownStatus: (taskId, status) =>
    set((state) => ({
      breakdownStatus: { ...state.breakdownStatus, [taskId]: status },
    })),

  openProjectDetail: (projectId) => set(() => ({ projectDetailRequest: projectId })),
  clearProjectDetailRequest: () => set(() => ({ projectDetailRequest: null })),
  openTeamEditor: (projectId, teamId = null) => set(() => ({ teamEditorRequest: { projectId, teamId } })),
  closeTeamEditor: () => set(() => ({ teamEditorRequest: null })),

  setTeams: (projectId, teams) =>
    set((s) => ({ teamsByProject: { ...s.teamsByProject, [projectId]: teams } })),

  setTaskTeam: (taskId, { runs, artifacts }) =>
    set((s) => ({
      teamRuns: { ...s.teamRuns, [taskId]: mergeById(s.teamRuns[taskId], runs, (r) => r.id, newerTeamRun) },
      teamArtifacts: {
        ...s.teamArtifacts,
        [taskId]: mergeById(s.teamArtifacts[taskId], artifacts, (a) => a.id, newerTeamArtifact),
      },
    })),

  upsertTeamRun: (run) =>
    set((s) => ({ teamRuns: { ...s.teamRuns, [run.taskId]: upsertById(s.teamRuns[run.taskId], run) } })),

  upsertTeamArtifact: (artifact) =>
    set((s) => ({
      teamArtifacts: {
        ...s.teamArtifacts,
        [artifact.taskId]: upsertById(s.teamArtifacts[artifact.taskId], artifact),
      },
    })),

  setWsConnected: (connected) => set(() => ({ wsConnected: connected })),
  setFilterText: (text) => set(() => ({ filterText: text })),
  setLang: (lang) => {
    if (typeof window !== "undefined") localStorage.setItem("lang", lang);
    set(() => ({ lang }));
  },
}));
