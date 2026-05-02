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

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  analysis: string;
  status: TaskStatus;
  priority?: TaskPriority | null;
  tags?: string[];
  branch?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  displayId?: string | null;
  createdAt: string;
  updatedAt: string;
  agent: AgentState;
  usage?: TaskUsage;
}

export type ProjectPlanningStatus = "idle" | "planning" | "done" | "error";

export interface Project {
  id: string;
  name: string;
  description?: string;
  aiPrompt?: string;
  repoPath: string;
  defaultBranch: string;
  remote?: string | null;
  createdAt?: string;
  planningStatus?: ProjectPlanningStatus;
  slug?: string | null;
  taskCounter?: number;
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

export interface AgentText {
  id: number;
  taskId: string;
  text: string;
  sequence: number;
  createdAt: string;
}

export type NodeRunStatus = "running" | "done" | "error" | "aborted";

export type NodeType =
  | "planner"
  | "coder"
  | "reviewer"
  | "tester"
  | "ci"
  | "fix"
  | "custom";

export interface NodeRun {
  id: string;
  taskId: string;
  nodeId: string;
  nodeType: NodeType;
  status: NodeRunStatus;
  startedAt: string;
  finishedAt: string | null;
  inputArtifact: Record<string, unknown> | null;
  outputArtifact: Record<string, unknown> | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string | null;
  ciIteration: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCall {
  id: string;
  taskId: string;
  toolName: string;
  args?: Record<string, unknown>;
  result: string | null;
  status: ToolCallStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
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
  | { type: "agent_tool_call"; taskId: string; payload: ToolCall }
  | { type: "agent_text"; taskId: string; payload: AgentText }
  | { type: "node_started"; taskId: string; payload: NodeRun }
  | { type: "node_finished"; taskId: string; payload: NodeRun }
  | {
      type: "node_log";
      taskId: string;
      payload: { nodeId: string; line: string };
    }
  | { type: "project_planning_started"; projectId: string }
  | {
      type: "project_planning_done";
      projectId: string;
      taskCount: number;
    }
  | { type: "project_planning_error"; projectId: string; error: string }
  | {
      type: "skill_install_progress";
      projectId: string;
      payload: {
        pluginId: string;
        status: "running" | "done" | "error";
        message: string;
      };
    }
  | {
      type: "clone_progress";
      targetPath: string;
      payload: {
        status: "cloning" | "done" | "error";
        message: string;
        project?: Project;
      };
    }
  | {
      type: "studio_generation";
      payload: {
        generationId: string;
        status: "running" | "done" | "error";
        chunk?: string;
        error?: string;
      };
    }
  | { type: "hello"; payload: { serverVersion: string } };

export interface AvailablePluginSource {
  source: string;
  url?: string;
  repo?: string;
  path?: string;
  ref?: string;
  sha?: string;
}

export interface AvailablePluginAuthor {
  name?: string;
  email?: string;
}

export interface AvailablePlugin {
  pluginId: string;
  name: string;
  description: string;
  marketplaceName: string;
  source: AvailablePluginSource;
  installCount?: number;
  homepage?: string;
  author?: AvailablePluginAuthor;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  scope: "user" | "project" | "local";
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
  projectPath?: string;
}

export interface ClaudeMarketplaceSource {
  source: string;
  repo?: string;
  url?: string;
  path?: string;
}

export interface ClaudeMarketplace {
  name: string;
  source: ClaudeMarketplaceSource;
}

export interface AgentGraphNode {
  id: string;
  type: "agent";
  position: { x: number; y: number };
  data: { slug: string };
}

export interface AgentGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface AgentGraph {
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

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
