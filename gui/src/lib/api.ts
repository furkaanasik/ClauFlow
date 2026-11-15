import type { AgentText, Comment, GithubRepo, GitStatus, TaskDiff, NodeRun, Project, ProjectPatch, Task, TaskPatch, TaskPriority, SkillCatalogEntry, SystemCapabilities, TaskTeamState, Team, TeamArtifact, TeamRole, ToolCall } from "@/types";
import { useBoardStore } from "@/store/boardStore";

const BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** UI language sent with run-starting calls so core writes the team summary in it (plan §3/10). */
function uiLang(): "tr" | "en" {
  return useBoardStore.getState().lang === "tr" ? "tr" : "en";
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON, leave as raw text
    }
    throw new ApiError(res.status, `API ${res.status}: ${text}`, body);
  }
  return res.json() as Promise<T>;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  analysis?: string;
  priority?: TaskPriority | string;
  status?: Task["status"];
  budgetUsd?: number | null;
  /** null / omitted = the project's default team. */
  teamId?: string | null;
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  repoPath: string;
  defaultBranch?: string;
  remote?: string | null;
  createGithubRepo?: boolean;
  repoName?: string;
  isPrivate?: boolean;
  budgetUsd?: number | null;
}

export interface InsightsByNodeType {
  nodeType: string;
  runCount: number;
  doneCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** CLI-reported cost; legacy rows without one are token-priced and flag `estimated`. */
  costUsd: number;
  estimated: boolean;
}

export interface InsightsRecentTask {
  id: string;
  displayId: string | null;
  title: string;
  status: string;
  agentStatus: string;
  createdAt: string;
  costUsd: number;
  timeToGreenMs: number | null;
  nodeRunCount: number;
}

export interface InsightsSummary {
  totalTasks: number;
  doneTasks: number;
  errorTasks: number;
  prCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  /** Tasks' lifetime spend + project planner spend. */
  costUsd: number;
  tasksCostUsd: number;
  planningCostUsd: number;
  avgTimeToGreenMs: number | null;
}

export interface InsightsData {
  projectId: string;
  summary: InsightsSummary;
  byNodeType: InsightsByNodeType[];
  recentTasks: InsightsRecentTask[];
}

export const api = {
  getTasks: async (projectId?: string): Promise<Task[]> => {
    const url = projectId
      ? `${BASE}/tasks?projectId=${encodeURIComponent(projectId)}`
      : `${BASE}/tasks`;
    const data = await fetch(url, { cache: "no-store" }).then(
      (r) => handle<{ tasks: Task[] }>(r),
    );
    return data.tasks ?? [];
  },

  getTask: (id: string): Promise<Task> =>
    fetch(`${BASE}/tasks/${id}`, { cache: "no-store" })
      .then((r) => handle<{ task: Task }>(r))
      .then((d) => d.task),

  createTask: (input: CreateTaskInput): Promise<Task> =>
    fetch(`${BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
      .then((r) => handle<{ task: Task }>(r))
      .then((d) => d.task),

  updateTask: (id: string, patch: TaskPatch): Promise<Task> =>
    fetch(`${BASE}/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch.status === "doing" ? { ...patch, uiLang: uiLang() } : patch),
    })
      .then((r) => handle<{ task: Task }>(r))
      .then((d) => d.task),

  getTaskDiff: (id: string): Promise<TaskDiff> =>
    fetch(`${BASE}/tasks/${id}/diff`).then((r) => handle<TaskDiff>(r)),

  deleteTask: (id: string): Promise<void> =>
    fetch(`${BASE}/tasks/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`API ${r.status}`);
    }),

  retryTask: (id: string): Promise<Task> =>
    fetch(`${BASE}/tasks/${id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiLang: uiLang() }),
    })
      .then((r) => handle<{ task: Task }>(r))
      .then((d) => d.task),

  abortTask: (id: string): Promise<{ aborted: boolean; source: string }> =>
    fetch(`${BASE}/tasks/${id}/abort`, { method: "POST" }).then((r) =>
      handle<{ aborted: boolean; source: string }>(r),
    ),

  breakdownTask: (id: string, prompt: string, maxTasks?: number): Promise<{ status: string }> =>
    fetch(`${BASE}/tasks/${id}/breakdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxTasks, uiLang: uiLang() }),
    }).then((r) => handle<{ status: string }>(r)),

  getProjects: (): Promise<Project[]> =>
    fetch(`${BASE}/projects`, { cache: "no-store" })
      .then((r) => handle<{ projects: Project[] }>(r))
      .then((d) => d.projects ?? []),

  getProject: (id: string): Promise<Project> =>
    fetch(`${BASE}/projects/${id}`, { cache: "no-store" })
      .then((r) => handle<{ project: Project }>(r))
      .then((d) => d.project),

  getProjectGitStatus: (id: string): Promise<GitStatus> =>
    fetch(`${BASE}/projects/${id}/git-status`, { cache: "no-store" })
      .then((r) => handle<GitStatus>(r)),

  getComments: (taskId: string): Promise<Comment[]> =>
    fetch(`${BASE}/tasks/${taskId}/comments`, { cache: "no-store" })
      .then((r) => handle<{ comments: Comment[] }>(r))
      .then((d) => d.comments),

  getToolCalls: (taskId: string): Promise<ToolCall[]> =>
    fetch(`${BASE}/tasks/${taskId}/tool-calls`, { cache: "no-store" })
      .then((r) => handle<{ toolCalls: ToolCall[] }>(r))
      .then((d) => d.toolCalls ?? []),

  getAgentTexts: (taskId: string): Promise<AgentText[]> =>
    fetch(`${BASE}/tasks/${taskId}/agent-texts`, { cache: "no-store" })
      .then((r) => handle<{ agentTexts: AgentText[] }>(r))
      .then((d) => d.agentTexts ?? []),

  addComment: (taskId: string, body: string): Promise<Comment> =>
    fetch(`${BASE}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    })
      .then((r) => handle<{ comment: Comment }>(r))
      .then((d) => d.comment),

  createProject: (
    input: CreateProjectInput,
  ): Promise<{ project: Project; githubError?: string | null }> =>
    fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
      .then((r) => handle<{ project: Project; githubError?: string | null }>(r))
      .then((d) => ({ project: d.project, githubError: d.githubError })),

  updateProject: (id: string, patch: ProjectPatch): Promise<Project> =>
    fetch(`${BASE}/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => handle<{ project: Project }>(r))
      .then((d) => d.project),

  deleteProject: (id: string): Promise<void> =>
    fetch(`${BASE}/projects/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`API ${r.status}`);
    }),

  getClaudeInstructions: (id: string): Promise<{ exists: boolean; content: string; path: string }> =>
    fetch(`${BASE}/projects/${id}/claude/instructions`, { cache: "no-store" })
      .then((r) => handle<{ exists: boolean; content: string; path: string }>(r)),

  putClaudeInstructions: (
    id: string,
    content: string,
  ): Promise<ClaudeInstructionsSaveResult> =>
    fetch(`${BASE}/projects/${id}/claude/instructions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).then((r) => handle<ClaudeInstructionsSaveResult>(r)),

  pushClaudeInstructions: async (
    id: string,
  ): Promise<{ pushed: true; branch: string }> => {
    const res = await fetch(`${BASE}/projects/${id}/claude/instructions/push`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      const detail = data.detail ? ` — ${data.detail}` : "";
      throw new Error(`${data.error ?? "push_failed"}${detail}`);
    }
    return res.json();
  },

  getPrereqs: (): Promise<{ allOk: boolean; items: PrereqItem[] }> =>
    fetch(`${BASE}/system/prereqs`, { cache: "no-store" })
      .then((r) => handle<{ allOk: boolean; items: PrereqItem[] }>(r)),

  listInstalledSkills: (id: string): Promise<{ installed: InstalledPlugin[] }> =>
    fetch(`${BASE}/projects/${id}/claude/skills`, { cache: "no-store" })
      .then((r) => handle<{ installed: InstalledPlugin[] }>(r)),

  uninstallSkill: (id: string, pluginId: string): Promise<{ ok: true; pluginId: string }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(pluginId)}`, {
      method: "DELETE",
    }).then((r) => handle<{ ok: true; pluginId: string }>(r)),

  enableSkill: (id: string, pluginId: string): Promise<{ ok: true; pluginId: string }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(pluginId)}/enable`, {
      method: "POST",
    }).then((r) => handle<{ ok: true; pluginId: string }>(r)),

  disableSkill: (id: string, pluginId: string): Promise<{ ok: true; pluginId: string }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(pluginId)}/disable`, {
      method: "POST",
    }).then((r) => handle<{ ok: true; pluginId: string }>(r)),

  listTeams: (projectId: string): Promise<Team[]> =>
    fetch(`${BASE}/teams?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((r) => handle<{ teams: Team[] }>(r))
      .then((d) => d.teams ?? []),

  /** Copy (`fromTeamId`) or create a team. `projectId: null` = a global template. */
  createTeam: (body: {
    name: string;
    description?: string;
    projectId: string | null;
    roles?: TeamRole[];
    fromTeamId?: string;
  }): Promise<Team> =>
    fetch(`${BASE}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => handle<{ team: Team }>(r))
      .then((d) => d.team),

  updateTeam: (id: string, patch: { name?: string; description?: string; roles?: TeamRole[] }): Promise<Team> =>
    fetch(`${BASE}/teams/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => handle<{ team: Team }>(r))
      .then((d) => d.team),

  deleteTeam: (id: string): Promise<void> =>
    fetch(`${BASE}/teams/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) return handle<void>(r);
    }),

  /** Unified skill list (user, project, plugin) for the role editor. */
  listSkillCatalog: (projectId: string): Promise<SkillCatalogEntry[]> =>
    fetch(`${BASE}/projects/${projectId}/claude/skills/catalog`, { cache: "no-store" })
      .then((r) => handle<{ skills: SkillCatalogEntry[] }>(r))
      .then((d) => d.skills ?? []),

  getCapabilities: (): Promise<SystemCapabilities> =>
    fetch(`${BASE}/system/capabilities`, { cache: "no-store" }).then((r) => handle<SystemCapabilities>(r)),

  getTaskTeam: (taskId: string): Promise<TaskTeamState> =>
    fetch(`${BASE}/tasks/${taskId}/team`, { cache: "no-store" })
      .then((r) => handle<TaskTeamState>(r))
      .then((d) => ({ runs: d.runs ?? [], artifacts: d.artifacts ?? [] })),

  /** Resume a run paused at the spec gate. `specBody` replaces the spec when the user edited it. */
  approveTeamSpec: (taskId: string, specBody?: string): Promise<{ task: Task; artifact: TeamArtifact }> =>
    fetch(`${BASE}/tasks/${taskId}/team/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(specBody ? { specBody, uiLang: uiLang() } : { uiLang: uiLang() }),
    }).then((r) => handle<{ task: Task; artifact: TeamArtifact }>(r)),

  getNodeRuns: (taskId: string): Promise<NodeRun[]> =>
    fetch(`${BASE}/tasks/${taskId}/node-runs`, { cache: "no-store" })
      .then((r) => handle<{ nodeRuns: NodeRun[] }>(r))
      .then((d) => d.nodeRuns ?? []),

  getInsights: (projectId: string): Promise<InsightsData> =>
    fetch(`${BASE}/insights?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
    }).then((r) => handle<InsightsData>(r)),

  getInsightsExportUrl: (projectId: string, format: "csv" | "json"): string =>
    `${BASE}/insights/export?projectId=${encodeURIComponent(projectId)}&format=${format}`,

  browseDirs: (path?: string, showHidden = false): Promise<DirListing> => {
    const params = new URLSearchParams();
    if (path) params.set("path", path);
    if (showHidden) params.set("showHidden", "1");
    const qs = params.toString();
    return fetch(`${BASE}/fs/browse${qs ? `?${qs}` : ""}`, { cache: "no-store" }).then((r) =>
      handle<DirListing>(r),
    );
  },

  makeDir: (parent: string, name: string): Promise<DirEntry> =>
    fetch(`${BASE}/fs/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent, name }),
    }).then((r) => handle<DirEntry>(r)),
};

export interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  home: string;
  entries: DirEntry[];
}

// ─── Skill / Plugin types ─────────────────────────────────────────────────────

export interface InstalledPlugin {
  id: string;
  version: string | null;
  scope: "user" | "project" | "local";
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string | null;
  projectPath?: string;
}

export interface ClaudeInstructionsSaveResult {
  exists: boolean;
  content: string;
  path: string;
  committed: boolean;
  commitSha: string | null;
  commitWarning: string | null;
}

export interface PrereqItem {
  name: string;
  found: boolean;
  version: string | null;
  installCmd: string;
  docsUrl: string;
}

export interface PRListItem {
  number: number;
  title: string;
  state: string;
  author: { login: string };
  url: string;
  createdAt: string;
  repository?: { nameWithOwner: string };
}

export interface PRFile {
  filename: string;
  status: "added" | "modified" | "deleted" | "renamed" | string;
  additions: number;
  deletions: number;
}

export interface PRDetails {
  files: PRFile[];
  additions: number;
  deletions: number;
}

const GHBASE = BASE.replace(/\/api$/, "");

export const githubApi = {
  getPRDetails: (number: number, projectId: string): Promise<PRDetails> =>
    fetch(`${GHBASE}/github/prs/${number}/details?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => handle<PRDetails>(r)),

  getPRDiff: (number: number, projectId: string): Promise<{ diff: string }> =>
    fetch(`${GHBASE}/github/prs/${number}/diff?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => handle<{ diff: string }>(r)),

  mergePR: (number: number, projectId: string): Promise<{ success: boolean }> =>
    fetch(`${GHBASE}/github/prs/${number}/merge?projectId=${encodeURIComponent(projectId)}`, {
      method: "POST",
    }).then((r) => handle<{ success: boolean }>(r)),
};

export interface GithubAuthStart {
  userCode: string;
  verificationUri: string;
}

export interface GithubAuthStatus {
  connected: boolean;
  user: string | null;
  userCode: string | null;
  verificationUri: string | null;
  error: string | null;
}

export interface CloneProjectInput {
  repoUrl: string;
  targetPath: string;
  name: string;
}

export async function getGithubRepos(): Promise<GithubRepo[]> {
  const res = await fetch(`${GHBASE}/github/repos`, { cache: "no-store" });
  const data = await handle<{ repos: GithubRepo[] }>(res);
  return data.repos ?? [];
}

export async function cloneProject(input: CloneProjectInput): Promise<{ status: "cloning"; targetPath: string }> {
  const res = await fetch(`${BASE}/projects/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle<{ status: "cloning"; targetPath: string }>(res);
}

export async function startGithubAuth(): Promise<GithubAuthStart> {
  const res = await fetch(`${BASE}/auth/github/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return handle<GithubAuthStart>(res);
}

export async function getGithubAuthStatus(): Promise<GithubAuthStatus> {
  const res = await fetch(`${BASE}/auth/github/status`, { cache: "no-store" });
  return handle<GithubAuthStatus>(res);
}
