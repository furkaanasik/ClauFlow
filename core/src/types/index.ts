export type TaskStatus = "todo" | "doing" | "review" | "done";

export type AgentStatus =
  | "idle"
  | "branching"
  | "running"
  | "pushing"
  | "pr_opening"
  | "done"
  | "error";

export interface AgentState {
  status: AgentStatus;
  currentStep?: string;
  log: string[];
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  analysis: string;
  status: TaskStatus;
  priority?: string | null;
  branch?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  createdAt: string;
  updatedAt: string;
  agent: AgentState;
}

export type ProjectPlanningStatus = "idle" | "planning" | "done" | "error";

export interface Project {
  id: string;
  name: string;
  description?: string;
  repoPath: string;
  defaultBranch: string;
  remote?: string | null;
  createdAt?: string;
  planningStatus?: ProjectPlanningStatus;
}

export interface TasksFile {
  version: string;
  updatedAt?: string;
  projects: Project[];
  tasks: Task[];
}

export type CommentStatus = "pending" | "running" | "done" | "error";

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  status: CommentStatus;
  agentLog: string[];
  createdAt: string;
}

export type WsMessage =
  | { type: "agent_log"; taskId: string; payload: { line: string } }
  | {
      type: "agent_status";
      taskId: string;
      payload: { status: AgentStatus; currentStep?: string };
    }
  | { type: "task_updated"; taskId: string; payload: Task }
  | { type: "task_created"; taskId: string; payload: Task }
  | { type: "task_deleted"; taskId: string; payload: { id: string } }
  | { type: "comment_updated"; taskId: string; payload: Comment }
  | { type: "project_planning_started"; projectId: string }
  | {
      type: "project_planning_done";
      projectId: string;
      taskCount: number;
    }
  | { type: "project_planning_error"; projectId: string; error: string }
  | { type: "hello"; payload: { serverVersion: string } };

export function createEmptyAgentState(): AgentState {
  return {
    status: "idle",
    currentStep: undefined,
    log: [],
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}
