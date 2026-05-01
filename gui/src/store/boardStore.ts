import { create } from "zustand";
import type { AgentStatus, AgentText, CloneStatus, Comment, ProjectPlanningStatus, Project, ProjectPatch, Task, TaskPatch, TaskStatus, ToolCall } from "@/types";
import type { SkillInstallProgress, SkillInstallStatus } from "@/lib/api";

type Lang = "tr" | "en";

function getInitialLang(): Lang {
  return "tr";
}

interface BoardState {
  tasks: Record<string, Task>;
  order: string[];
  projects: Project[];
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
  /** Skill install progress keyed by `${projectId}:${skillSlug}` */
  skillProgress: Record<string, { status: SkillInstallStatus; message?: string }>;

  studioGeneration: {
    generationId: string | null;
    status: "idle" | "running" | "done" | "error";
    text: string;
    error: string | null;
  };

  studioReset: () => void;
  studioStart: (id: string) => void;
  studioAppend: (chunk: string) => void;
  studioFinish: () => void;
  studioError: (msg: string) => void;

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

  setSkillProgress: (progress: SkillInstallProgress) => void;
  clearSkillProgress: (projectId: string, pluginId: string) => void;

  getByStatus: (status: TaskStatus) => Task[];
}

const LOG_LIMIT = 500;

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: {},
  order: [],
  projects: [],
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
  skillProgress: {},

  studioGeneration: {
    generationId: null,
    status: "idle",
    text: "",
    error: null,
  },

  studioReset: () =>
    set(() => ({
      studioGeneration: { generationId: null, status: "idle", text: "", error: null },
    })),

  studioStart: (id) =>
    set(() => ({
      studioGeneration: { generationId: id, status: "running", text: "", error: null },
    })),

  studioAppend: (chunk) =>
    set((state) => ({
      studioGeneration: { ...state.studioGeneration, text: state.studioGeneration.text + chunk },
    })),

  studioFinish: () =>
    set((state) => ({
      studioGeneration: { ...state.studioGeneration, status: "done" },
    })),

  studioError: (msg) =>
    set((state) => ({
      studioGeneration: { ...state.studioGeneration, status: "error", error: msg },
    })),

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
      toolCalls: { ...state.toolCalls, [taskId]: calls },
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
      agentTexts: { ...state.agentTexts, [taskId]: list },
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
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, planningStatus: status, planningError: error ?? null }
          : p,
      ),
    })),

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

  setSkillProgress: ({ projectId, pluginId, status, message }) =>
    set((state) => ({
      skillProgress: {
        ...state.skillProgress,
        [`${projectId}:${pluginId}`]: { status, message },
      },
    })),

  clearSkillProgress: (projectId, pluginId) =>
    set((state) => {
      const key = `${projectId}:${pluginId}`;
      if (!state.skillProgress[key]) return state;
      const { [key]: _removed, ...rest } = state.skillProgress;
      void _removed;
      return { skillProgress: rest };
    }),

  setWsConnected: (connected) => set(() => ({ wsConnected: connected })),
  setFilterText: (text) => set(() => ({ filterText: text })),
  setLang: (lang) => {
    if (typeof window !== "undefined") localStorage.setItem("lang", lang);
    set(() => ({ lang }));
  },

  getByStatus: (status) => {
    const { tasks, order, filterText } = get();
    const needle = filterText.trim().toLowerCase();
    return order
      .map((id) => tasks[id])
      .filter((t) => {
        if (!t || t.status !== status) return false;
        if (!needle) return true;
        return t.title.toLowerCase().includes(needle) ||
          (t.description ?? "").toLowerCase().includes(needle);
      });
  },
}));
