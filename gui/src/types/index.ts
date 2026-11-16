export type TaskStatus = "todo" | "doing" | "review" | "done";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type AgentStatus =
  | "idle"
  | "branching"
  | "running"
  | "pushing"
  | "pr_opening"
  | "awaiting_approval"
  /** zincir: dragged to Doing but a dependency is not done yet; holds no repo lock. */
  | "waiting_deps"
  /**
   * zincir F4.6 (§3/33): in Review, the AI conflict resolver works on the
   * branch. `currentStep`: queued | merging | resolving | verifying | qa | pushing.
   * Success → `done` + currentStep `conflict_resolved`; failure → `error` +
   * `conflict_unresolved:<reason>`.
   */
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
  /** zincir: ids of same-project tasks this one waits for (in board order). */
  dependsOn?: string[];
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

type TeamArtifactKind =
  | "brief"
  | "spec"
  | "delivery"
  | "qa_report"
  | "stuck"
  | "summary";

type QaVerdict = "pass" | "fail";

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

/** zincir F4.6 (§3/46): `POST /tasks/:id/resolve` mode. */
export type ConflictResolveMode = "conflict" | "update";

/** zincir F4.6 (§3/46): `GET /tasks/:id/base-drift` (read-only, no fetch). */
export interface BaseDrift {
  base: string;
  /** `origin/<base>` when the remote-tracking ref exists, else `<base>`. */
  target: string;
  /** Commits on `target` the task branch does not have (0 when there is no branch). */
  behind: number;
  mergeBase: string | null;
}

export interface GitStatus {
  branch: string | null;
  isDirty: boolean;
}

/** zincir E6: why ClauFlow stashed a dirty tree (`resolve` = F4.6 conflict resolver). */
export type StashReason = "run" | "merge" | "comment" | "resolve";

/** zincir E6 (plan §5.9): one of ClauFlow's stashes, `GET /projects/:id/stashes`. */
export interface StashEntry {
  /** Stash commit SHA; restore/drop address the stash by it. */
  ref: string;
  label: string;
  reason: StashReason;
  taskId: string | null;
  displayId: string | null;
  /** ISO time the stash was taken. */
  createdAt: string;
  /** Files in the stash (tracked + untracked), at most 20. */
  files: string[];
  /** bakim #6: class counts of the whole stash. */
  summary?: StashSummary;
  /** No `code` file in the stash (only dependencies, build output, lock/OS files). */
  safeToDrop?: boolean;
}

/** bakim #6 (plan §3/14): core `noisePaths.classifyPath`. */
export type StashFileClass = "deps" | "build" | "lock_os" | "code";

/** `U` = untracked (the stash's third parent). */
export type StashFileStatus = "M" | "A" | "D" | "T" | "U";

export interface StashSummary {
  total: number;
  deps: number;
  build: number;
  lockOs: number;
  code: number;
  untracked: number;
}

export interface StashFile {
  path: string;
  status: StashFileStatus;
  class: StashFileClass;
}

/** Noise files folded under their root (`node_modules/`), at most 200 sample paths. */
export interface StashGroup {
  root: string;
  class: StashFileClass;
  count: number;
  sample: string[];
}

/** `GET /projects/:id/stashes/:ref/files`. */
export interface StashDetail {
  ref: string;
  label: string;
  summary: StashSummary;
  safeToDrop: boolean;
  codeFiles: StashFile[];
  lockOsFiles: StashFile[];
  groups: StashGroup[];
  truncated: boolean;
}

/** `GET /projects/:id/stashes/:ref/diff?path=`. */
export interface StashFileDiff {
  path: string;
  status: StashFileStatus;
  diff: string;
  truncated: boolean;
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

type NodeRunStatus = "running" | "done" | "error" | "aborted";

type NodeType =
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

type ToolCallStatus = "running" | "done" | "error";

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

interface CloneProgress {
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
  | { type: "task_breakdown_error"; taskId: string; error: string }
  | { type: "chain_advanced"; taskId: string; payload: ChainAdvancedPayload }
  | { type: "stash_created"; taskId: string | null; payload: StashCreatedPayload };

/** zincir E6 (plan §3/28, §5.7): ClauFlow stashed a dirty tree (core `broadcastStashCreated`). */
export interface StashCreatedPayload {
  projectId: string;
  label: string;
  reason: StashReason;
  displayId: string | null;
}

/** zincir: a done task started its waiting dependents (core `broadcastChainAdvanced`). */
export interface ChainAdvancedPayload {
  projectId: string;
  displayId: string | null;
  /** true when the done transition came from review (a merge). */
  merged: boolean;
  started: Array<{ id: string; displayId: string | null }>;
}

interface BudgetExceededPayload {
  spentUsd: number;
  budgetUsd: number;
  taskTitle: string;
  displayId: string | null;
  projectId: string;
  projectName: string;
}
