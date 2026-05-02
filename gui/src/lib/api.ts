import type { AgentGraph, AgentText, Comment, GithubRepo, NodeRun, Project, ProjectPatch, Task, TaskPatch, TaskPriority, ToolCall } from "@/types";

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
      body: JSON.stringify(patch),
    })
      .then((r) => handle<{ task: Task }>(r))
      .then((d) => d.task),

  deleteTask: (id: string): Promise<void> =>
    fetch(`${BASE}/tasks/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`API ${r.status}`);
    }),

  retryTask: (id: string): Promise<Task> =>
    fetch(`${BASE}/tasks/${id}/retry`, { method: "POST" })
      .then((r) => handle<{ task: Task }>(r))
      .then((d) => d.task),

  abortTask: (id: string): Promise<{ aborted: boolean; source: string }> =>
    fetch(`${BASE}/tasks/${id}/abort`, { method: "POST" }).then((r) =>
      handle<{ aborted: boolean; source: string }>(r),
    ),

  getProjects: (): Promise<Project[]> =>
    fetch(`${BASE}/projects`, { cache: "no-store" })
      .then((r) => handle<{ projects: Project[] }>(r))
      .then((d) => d.projects ?? []),

  getProject: (id: string): Promise<Project> =>
    fetch(`${BASE}/projects/${id}`, { cache: "no-store" })
      .then((r) => handle<{ project: Project }>(r))
      .then((d) => d.project),

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

  deleteProjectGithub: (id: string): Promise<Project> =>
    fetch(`${BASE}/projects/${id}/github`, { method: "DELETE" })
      .then((r) => handle<{ project: Project }>(r))
      .then((d) => d.project),

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

  pushClaude: async (id: string): Promise<{ pushed: true; branch: string }> => {
    const res = await fetch(`${BASE}/projects/${id}/claude/push`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      const detail = data.detail ? ` — ${data.detail}` : "";
      throw new Error(`${data.error ?? "push_failed"}${detail}`);
    }
    return res.json();
  },

  listClaudeAgents: (id: string): Promise<{ exists: boolean; dir: string; agents: ClaudeAgent[] }> =>
    fetch(`${BASE}/projects/${id}/claude/agents`, { cache: "no-store" })
      .then((r) => handle<{ exists: boolean; dir: string; agents: ClaudeAgent[] }>(r)),

  getClaudeAgent: (id: string, slug: string): Promise<ClaudeAgent> =>
    fetch(`${BASE}/projects/${id}/claude/agents/${slug}`, { cache: "no-store" })
      .then((r) => handle<ClaudeAgent>(r)),

  createClaudeAgent: (
    id: string,
    input: { slug: string; name?: string; model?: string; description?: string; body?: string },
  ): Promise<ClaudeAgentSaveResult> =>
    fetch(`${BASE}/projects/${id}/claude/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => handle<ClaudeAgentSaveResult>(r)),

  updateClaudeAgent: (
    id: string,
    slug: string,
    input: { name?: string; model?: string; description?: string; body?: string },
  ): Promise<ClaudeAgentSaveResult> =>
    fetch(`${BASE}/projects/${id}/claude/agents/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => handle<ClaudeAgentSaveResult>(r)),

  deleteClaudeAgent: (
    id: string,
    slug: string,
  ): Promise<{ deleted: true; slug: string; committed: boolean; commitSha: string | null; commitWarning: string | null }> =>
    fetch(`${BASE}/projects/${id}/claude/agents/${slug}`, { method: "DELETE" })
      .then((r) =>
        handle<{ deleted: true; slug: string; committed: boolean; commitSha: string | null; commitWarning: string | null }>(r),
      ),

  listSkillRegistry: (id: string): Promise<{ available: AvailablePlugin[] }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/registry`, { cache: "no-store" })
      .then((r) => handle<{ available: AvailablePlugin[] }>(r)),

  listInstalledSkills: (id: string): Promise<{ installed: InstalledPlugin[] }> =>
    fetch(`${BASE}/projects/${id}/claude/skills`, { cache: "no-store" })
      .then((r) => handle<{ installed: InstalledPlugin[] }>(r)),

  installSkill: (
    id: string,
    pluginId: string,
    scope?: InstalledPlugin["scope"],
  ): Promise<{ ok: true; pluginId: string }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(pluginId)}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: scope ?? "local" }),
    }).then((r) => handle<{ ok: true; pluginId: string }>(r)),

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

  listMarketplaces: (id: string): Promise<{ marketplaces: ClaudeMarketplace[] }> =>
    fetch(`${BASE}/projects/${id}/claude/marketplaces`, { cache: "no-store" })
      .then((r) => handle<{ marketplaces: ClaudeMarketplace[] }>(r)),

  addMarketplace: (
    id: string,
    source: string,
  ): Promise<{ ok: true; marketplace: ClaudeMarketplace }> =>
    fetch(`${BASE}/projects/${id}/claude/marketplaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    }).then((r) => handle<{ ok: true; marketplace: ClaudeMarketplace }>(r)),

  removeMarketplace: (id: string, name: string): Promise<{ ok: true; name: string }> =>
    fetch(`${BASE}/projects/${id}/claude/marketplaces/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).then((r) => handle<{ ok: true; name: string }>(r)),

  postStudioGenerate: (
    id: string,
    body: { prompt: string; skills?: string[] },
  ): Promise<{ generationId: string; markdown: string }> =>
    fetch(`${BASE}/projects/${id}/claude/agents/studio/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ generationId: string; markdown: string }>(r)),

  getProjectSkills: (id: string): Promise<InstalledPlugin[]> =>
    fetch(`${BASE}/projects/${id}/claude/skills`, { cache: "no-store" })
      .then((r) => handle<{ installed: InstalledPlugin[] }>(r))
      .then((d) => d.installed ?? []),

  getProjectGraph: (id: string): Promise<AgentGraph> =>
    fetch(`${BASE}/projects/${id}/claude/graph`, { cache: "no-store" })
      .then((r) => handle<AgentGraph>(r)),

  putProjectGraph: (id: string, body: AgentGraph): Promise<AgentGraph> =>
    fetch(`${BASE}/projects/${id}/claude/graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<AgentGraph>(r)),

  getNodeRuns: (taskId: string): Promise<NodeRun[]> =>
    fetch(`${BASE}/tasks/${taskId}/node-runs`, { cache: "no-store" })
      .then((r) => handle<{ nodeRuns: NodeRun[] }>(r))
      .then((d) => d.nodeRuns ?? []),

  abortNode: (
    taskId: string,
    nodeId: string,
  ): Promise<{ aborted: true; nodeId: string }> =>
    fetch(
      `${BASE}/tasks/${taskId}/nodes/${encodeURIComponent(nodeId)}/abort`,
      { method: "POST" },
    ).then((r) => handle<{ aborted: true; nodeId: string }>(r)),

  retryNode: (
    taskId: string,
    nodeId: string,
  ): Promise<{ task: Task; resumeFromNodeId: string }> =>
    fetch(
      `${BASE}/tasks/${taskId}/nodes/${encodeURIComponent(nodeId)}/retry`,
      { method: "POST" },
    ).then((r) => handle<{ task: Task; resumeFromNodeId: string }>(r)),

  getPricing: async (): Promise<PricingResponse> => {
    const res = await fetch(`${BASE}/pricing`, { cache: "no-store" });
    return handle<PricingResponse>(res);
  },
};

export interface ModelPricing {
  model: string;
  inputPerM: number;
  outputPerM: number;
  cacheCreationPerM: number;
  cacheReadPerM: number;
}

export interface PricingResponse {
  defaultModel: string;
  pricing: ModelPricing[];
}

// ─── Skill / Plugin types ─────────────────────────────────────────────────────

export interface AvailablePluginSource {
  source: string;
  repo?: string;
  url?: string;
  path?: string;
}

export interface AvailablePlugin {
  pluginId: string;
  name: string;
  description: string;
  marketplaceName: string;
  source: AvailablePluginSource;
  installCount?: number;
  homepage?: string;
  author?: string;
}

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

export interface ClaudeMarketplace {
  name: string;
  source: { source: string; repo?: string; url?: string; path?: string };
}

export type SkillInstallStatus = "running" | "done" | "error";

export interface SkillInstallProgress {
  pluginId: string;
  projectId: string;
  status: SkillInstallStatus;
  message?: string;
}

export interface ClaudeAgent {
  slug: string;
  name: string;
  model: string | null;
  description: string | null;
  allowedTools: string | null;
  body: string;
  path: string;
}

export interface ClaudeAgentSaveResult extends ClaudeAgent {
  committed: boolean;
  commitSha: string | null;
  commitWarning: string | null;
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
  listPRs: (projectId: string): Promise<PRListItem[]> =>
    fetch(`${GHBASE}/github/prs?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => handle<PRListItem[]>(r)),

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
  if (res.status === 409) {
    const text = await res.text().catch(() => res.statusText);
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* ignore */ }
    throw new Error(msg);
  }
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
