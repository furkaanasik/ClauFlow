export type TaskStatus = "todo" | "doing" | "review" | "done";

export type AgentStatus =
  | "idle"
  | "branching"
  | "running"
  | "pushing"
  | "pr_opening"
  | "awaiting_approval"
  /** zincir: in Doing but not started; waits for its dependencies (holds no repo lock). */
  | "waiting_deps"
  /** zincir F4.6: in Review while the AI conflict resolver runs (plan §3/33). */
  | "resolving_conflict"
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
  /** Lifetime spend in USD: sum of every CLI call's `total_cost_usd` (roles, comments, breakdowns). */
  costUsd?: number;
  /** zincir: ids of same-project tasks this task waits for (edges in `task_dependencies`). */
  dependsOn: string[];
  /**
   * bakim #8: image attachments (task + comment images; comment drafts not yet
   * linked to a comment are left out). No file paths: served by `GET /api/attachments/:id`.
   */
  attachments: TaskAttachmentMeta[];
}

/** bakim #8: one image attachment as the GUI sees it (`task_attachments` row without its path). */
export interface TaskAttachmentMeta {
  id: string;
  /** null = attached to the task itself; else the comment it belongs to. */
  commentId: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  name: string | null;
  createdAt: string;
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
  /** CLI-reported cost of this node (role) run; null for legacy rows and subagents. */
  costUsd: number | null;
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
  | { type: "project_planning_started"; projectId: string }
  | {
      type: "project_planning_done";
      projectId: string;
      taskCount: number;
    }
  | { type: "project_planning_error"; projectId: string; error: string }
  | {
      type: "clone_progress";
      targetPath: string;
      payload: {
        status: "cloning" | "done" | "error";
        message: string;
        project?: Project;
      };
    }
  | { type: "hello"; payload: { serverVersion: string } }
  | {
      type: "budget_exceeded";
      taskId: string;
      payload: BudgetExceededPayload;
    }
  | { type: "task_breakdown_started"; taskId: string }
  | { type: "task_breakdown_done"; taskId: string; taskCount: number }
  | { type: "task_breakdown_error"; taskId: string; error: string }
  | {
      /** zincir (plan §3/12, §5.7): `taskId` became done and these waiting tasks started. */
      type: "chain_advanced";
      taskId: string;
      payload: ChainAdvancedPayload;
    }
  | {
      type: "stash_created";
      taskId: string | null;
      payload: StashCreatedPayload;
    };

/** zincir E6 (plan §3/28, §5.7): ClauFlow took a stash of a dirty tree. */
export interface StashCreatedPayload {
  projectId: string;
  label: string;
  /** `resolve` is the F4.6 conflict resolver's `clauflow-resolve-<taskId>` stash. */
  reason: "run" | "merge" | "comment" | "resolve";
  displayId: string | null;
}

export interface ChainAdvancedPayload {
  projectId: string;
  displayId: string | null;
  /** true when the done transition came from review (a merge). */
  merged: boolean;
  started: Array<{ id: string; displayId: string | null }>;
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

export interface BudgetExceededPayload {
  spentUsd: number;
  budgetUsd: number;
  taskTitle: string;
  displayId: string | null;
  projectId: string;
  projectName: string;
}
