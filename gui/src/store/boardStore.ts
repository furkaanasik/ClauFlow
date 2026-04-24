import { create } from "zustand";
import type { AgentStatus, Comment, PlanningStatus, Project, ProjectPatch, Task, TaskPatch, TaskStatus } from "@/types";

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
  wsConnected: boolean;
  filterText: string;
  lang: Lang;
  /** IDs of tasks recently added via WS — used to trigger drop animation */
  newTaskIds: Set<string>;

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

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, patch: ProjectPatch) => void;
  deleteProject: (id: string) => void;
  addTask: (task: Task) => void;
  selectProject: (id: string | null) => void;
  updateProjectPlanningStatus: (projectId: string, status: PlanningStatus, error?: string) => void;

  selectTask: (id: string | null) => void;

  upsertComment: (comment: Comment) => void;

  setWsConnected: (connected: boolean) => void;
  setFilterText: (text: string) => void;
  setLang: (lang: Lang) => void;
  clearNewTaskId: (id: string) => void;

  getByStatus: (status: TaskStatus) => Task[];
}

const LOG_LIMIT = 500;

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: {},
  order: [],
  projects: [],
  selectedProjectId: null,
  selectedTaskId: null,
  wsConnected: false,
  filterText: "",
  lang: getInitialLang(),
  newTaskIds: new Set<string>(),

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
      return {
        tasks: { ...state.tasks, [task.id]: task },
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
    set(() => ({
      selectedProjectId: id,
      tasks: {},
      order: [],
      selectedTaskId: null,
    })),

  selectTask: (id) => set(() => ({ selectedTaskId: id })),

  clearNewTaskId: (id) =>
    set((state) => {
      if (!state.newTaskIds.has(id)) return state;
      const newTaskIds = new Set(state.newTaskIds);
      newTaskIds.delete(id);
      return { newTaskIds };
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
