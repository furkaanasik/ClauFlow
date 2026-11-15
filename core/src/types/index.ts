export type TaskStatus = "todo" | "doing" | "ci" | "review" | "done" | "nothing";

export type AgentStatus =
  | "idle"
  | "branching"
  | "running"
  | "pushing"
  | "pr_opening"
  | "awaiting_approval"
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
  budgetUsd?: number | null;
  parentTaskId?: string | null;
  teamId?: string | null;
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
  budgetUsd?: number | null;
  defaultTeamId?: string | null;
  qaMaxRounds?: number;
  specApproval?: boolean;
}

export type RoleKind = "ceo" | "analyst" | "developer" | "qa";

export const ROLE_KINDS: readonly RoleKind[] = ["ceo", "analyst", "developer", "qa"];

export interface TeamRole {
  id: string;
  kind: RoleKind;
  name: string;
  instructions: string;
  model: string;
  advisorModel: string | null;
  tools: string[];
  skills: string[];
}

export interface Team {
  id: string;
  projectId: string | null;
  templateKey: string | null;
  name: string;
  description: string;
  roles: TeamRole[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TeamRunStatus =
  | "running"
  | "awaiting_approval"
  | "delivered"
  | "explored"
  | "stuck"
  | "error"
  | "aborted";

export interface TeamRun {
  id: string;
  taskId: string;
  teamId: string | null;
  teamSnapshot: Team;
  status: TeamRunStatus;
  qaRound: number;
  stopReason: string | null;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

export type TeamArtifactKind =
  | "brief"
  | "spec"
  | "delivery"
  | "qa_report"
  | "stuck"
  | "summary";

export type QaVerdict = "pass" | "fail";

export interface TeamArtifact {
  id: string;
  runId: string;
  taskId: string;
  roleId: string | null;
  roleKind: RoleKind | null;
  kind: TeamArtifactKind;
  round: number;
  body: string;
  verdict: QaVerdict | null;
  approved: boolean | null;
  commitSha: string | null;
  nodeRunId: string | null;
  costUsd: number | null;
  createdAt: string;
}

export type SkillSource = "user" | "project" | "plugin";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  source: SkillSource;
  pluginId?: string;
  description: string;
}

export interface SystemCapabilities {
  advisor: boolean;
  models: string[];
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
  | "custom"
  | "subagent"
  | "ceo"
  | "analyst"
  | "developer"
  | "qa";

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
  | { type: "team_run_updated"; taskId: string; payload: TeamRun }
  | { type: "team_artifact"; taskId: string; payload: TeamArtifact }
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
  | { type: "hello"; payload: { serverVersion: string } }
  | {
      type: "ci_check_status";
      taskId: string;
      payload: { prNumber: number; verdict: CiVerdict };
    }
  | {
      type: "ci_iteration_started";
      taskId: string;
      payload: { iteration: number; maxIterations: number };
    }
  | {
      type: "ci_iteration_result";
      taskId: string;
      payload: { iteration: number; outcome: "pass" | "fail" | "exhausted" };
    }
  | {
      type: "budget_exceeded";
      taskId: string;
      payload: { spentUsd: number; budgetUsd: number };
    }
  | { type: "task_breakdown_started"; taskId: string }
  | { type: "task_breakdown_done"; taskId: string; taskCount: number }
  | { type: "task_breakdown_error"; taskId: string; error: string };

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

export interface CiFailure {
  jobName: string;
  conclusion: "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED";
  link: string | null;
  logTail: string | null;
}

export interface CiFailureArtifact {
  prNumber: number;
  iteration: number;
  failures: CiFailure[];
  capturedAt: string;
}

export type CiVerdict =
  | { kind: "pending" }
  | { kind: "pass" }
  | { kind: "fail"; failures: CiFailure[] }
  | { kind: "no_checks" }
  | { kind: "timeout" };

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
