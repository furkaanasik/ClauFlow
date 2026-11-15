export type TaskStatus = "todo" | "doing" | "review" | "done";

export type TaskPriority = "low" | "medium" | "high" | "critical";

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
  budgetUsd?: number | null;
  parentTaskId?: string | null;
  /** Team chosen for this task; null = the project's default team. */
  teamId?: string | null;
  /** Lifetime spend in USD from the CLI's `total_cost_usd` (roles, comments, breakdowns). */
  costUsd?: number;
}

export type ProjectPlanningStatus = "idle" | "planning" | "done" | "error";

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
  planningStatus?: ProjectPlanningStatus;
  planningError?: string | null;
  budgetUsd?: number | null;
  defaultTeamId?: string | null;
  qaMaxRounds?: number;
  specApproval?: boolean;
  /** Project planner spend in USD (belongs to no task). */
  planningCostUsd?: number;
  /**
   * Derived from `git remote` when the project is served (30 s cache), never
   * stored. `false` = local flow: Review, local diff, local `--no-ff` merge.
   */
  hasRemote?: boolean;
}

export type RoleKind = "ceo" | "analyst" | "developer" | "qa";

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

/** Why a team run stopped early (`TeamRun.stopReason`). Other values are free text (errors). */
export type TeamStopReason =
  | "stalled"
  | "round_limit"
  | "budget"
  | "aborted"
  | "superseded"
  | "server_restart";

/** `GET /api/tasks/:id/team` */
export interface TaskTeamState {
  runs: TeamRun[];
  artifacts: TeamArtifact[];
}

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

export interface GitStatus {
  branch: string | null;
  isDirty: boolean;
}

/** `GET /tasks/:id/diff`: the task branch against base (`<base>...<branch>`). */
export interface TaskDiff {
  base: string;
  branch: string;
  /** `git diff --stat` output. */
  stat: string;
  /** Unified diff, cut at 200 000 characters when `truncated`. */
  diff: string;
  truncated: boolean;
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name"
    | "slug"
    | "description"
    | "aiPrompt"
    | "repoPath"
    | "defaultBranch"
    | "remote"
    | "budgetUsd"
    | "defaultTeamId"
    | "qaMaxRounds"
    | "specApproval"
  >
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
    | "budgetUsd"
    | "parentTaskId"
    | "teamId"
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

export type NodeRunStatus = "running" | "done" | "error" | "aborted";

export type NodeType =
  | "planner"
  | "coder"
  | "reviewer"
  | "tester"
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
  /** CLI-reported cost of this role run; null for legacy rows and subagents. */
  costUsd?: number | null;
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

export interface GithubRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  sshUrl: string;
  visibility: string;
  updatedAt: string;
  isLocal: boolean;
  localPath?: string;
}

export type CloneStatus = "cloning" | "done" | "error";

export interface CloneProgress {
  status: CloneStatus;
  message: string;
  project?: Project;
}

export type WsMessage =
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
  | { type: "node_started"; taskId: string; payload: NodeRun }
  | { type: "node_finished"; taskId: string; payload: NodeRun }
  | { type: "team_run_updated"; taskId: string; payload: TeamRun }
  | { type: "team_artifact"; taskId: string; payload: TeamArtifact }
  | { type: "task_updated"; taskId: string; payload: Task }
  | { type: "task_created"; taskId: string; payload: Task }
  | { type: "task_deleted"; taskId: string; payload: { id: string } }
  | { type: "comment_updated"; taskId: string; payload: Comment }
  | { type: "project_planning_started"; projectId: string }
  | { type: "project_planning_done"; projectId: string; taskCount: number }
  | { type: "project_planning_error"; projectId: string; error: string }
  | { type: "clone_progress"; targetPath: string; payload: CloneProgress }
  | { type: "hello"; payload: { serverVersion: string } }
  | {
      type: "budget_exceeded";
      taskId: string;
      payload: BudgetExceededPayload;
    }
  | { type: "task_breakdown_started"; taskId: string }
  | { type: "task_breakdown_done"; taskId: string; taskCount: number }
  | { type: "task_breakdown_error"; taskId: string; error: string };

export interface BudgetExceededPayload {
  spentUsd: number;
  budgetUsd: number;
  taskTitle: string;
  displayId: string | null;
  projectId: string;
  projectName: string;
}
