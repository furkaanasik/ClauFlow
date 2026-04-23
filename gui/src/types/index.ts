export type TaskStatus = "todo" | "doing" | "review" | "done";

export type TaskPriority = "low" | "medium" | "high" | "critical";

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
  comments?: Comment[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  repoPath: string;
  defaultBranch: string;
  remote?: string | null;
  createdAt?: string;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "analysis"
    | "status"
    | "priority"
    | "branch"
    | "prUrl"
    | "prNumber"
  >
> & { agent?: Partial<AgentState> };

export type CommentStatus = "pending" | "running" | "done" | "error";

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  status: CommentStatus;
  agentLog: string[];
  createdAt: string;
}

export type WsEvent =
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
  | { type: "hello"; payload: { serverVersion: string } };
