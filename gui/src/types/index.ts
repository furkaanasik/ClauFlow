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
  displayId?: string;
  title: string;
  description: string;
  analysis: string;
  status: TaskStatus;
  priority?: TaskPriority | null;
  tags?: string[] | null;
  branch?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  createdAt: string;
  updatedAt: string;
  agent: AgentState;
  comments?: Comment[];
  usage?: TaskUsage;
}

export type PlanningStatus = "idle" | "planning" | "done" | "error";

export interface Project {
  id: string;
  name: string;
  slug?: string;
  taskCounter?: number;
  description?: string;
  aiPrompt?: string;
  repoPath: string;
  defaultBranch: string;
  remote?: string | null;
  createdAt?: string;
  planningStatus?: PlanningStatus;
  planningError?: string | null;
}

export type ProjectPatch = Partial<
  Pick<Project, "name" | "slug" | "description" | "aiPrompt" | "repoPath" | "defaultBranch" | "remote">
>;

export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "analysis"
    | "status"
    | "priority"
    | "tags"
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

export interface AgentText {
  id: number;
  taskId: string;
  text: string;
  sequence: number;
  createdAt: string; // ISO — same format as tool_call.startedAt
}

export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCall {
  id: string;
  taskId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  status: ToolCallStatus;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
}

export type WsEvent =
  | { type: "agent_log"; taskId: string; payload: { line: string } }
  | {
      type: "agent_status";
      taskId: string;
      payload: { status: AgentStatus; currentStep?: string };
    }
  | {
      type: "agent_tool_call";
      taskId: string;
      payload: ToolCall;
    }
  | { type: "agent_text"; taskId: string; payload: AgentText }
  | { type: "task_updated"; taskId: string; payload: Task }
  | { type: "task_created"; taskId: string; payload: Task }
  | { type: "task_deleted"; taskId: string; payload: { id: string } }
  | { type: "comment_updated"; taskId: string; payload: Comment }
  | { type: "project_planning_started"; projectId: string }
  | { type: "project_planning_done"; projectId: string; taskCount: number }
  | { type: "project_planning_error"; projectId: string; error: string }
  | { type: "hello"; payload: { serverVersion: string } };
