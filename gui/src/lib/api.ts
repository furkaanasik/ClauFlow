import type { AgentText, Comment, GithubRepo, Project, ProjectPatch, Task, TaskPatch, TaskPriority, ToolCall } from "@/types";

const BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001/api";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
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

  listSkillsRegistry: (id: string): Promise<{ skills: RegistrySkill[] }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/registry`, { cache: "no-store" })
      .then((r) => handle<{ skills: RegistrySkill[] }>(r)),

  listInstalledSkills: (id: string): Promise<InstalledSkillsResponse> =>
    fetch(`${BASE}/projects/${id}/claude/skills`, { cache: "no-store" })
      .then((r) => handle<InstalledSkillsResponse>(r)),

  installSkill: (id: string, slug: string): Promise<{ queued: true; slug: string }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(slug)}/install`, {
      method: "POST",
    }).then((r) => handle<{ queued: true; slug: string }>(r)),

  enableSkill: (id: string, slug: string): Promise<{ slug: string; enabled: true }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(slug)}/enable`, {
      method: "POST",
    }).then((r) => handle<{ slug: string; enabled: true }>(r)),

  disableSkill: (id: string, slug: string): Promise<{ slug: string; enabled: false }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(slug)}/disable`, {
      method: "POST",
    }).then((r) => handle<{ slug: string; enabled: false }>(r)),

  removeSkill: (id: string, slug: string): Promise<{ removed: true; slug: string }> =>
    fetch(`${BASE}/projects/${id}/claude/skills/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    }).then((r) => handle<{ removed: true; slug: string }>(r)),
};

export interface RegistrySkill {
  slug: string;
  name: string;
  description: string;
  author: string;
  version: string;
  repoUrl: string;
  homepage?: string;
  tags?: string[];
}

/** Managed project plugin — installed via ClauFlow, enable/disable/remove actions available */
export interface InstalledSkill {
  slug: string;
  enabled: boolean;
  source: "project";
  repoUrl: string;
  version: string | null;
  path: string;
  directoryExists: boolean;
  managed: true;
}

export type ClaudePluginScope = "local" | "project" | "user";

/** Read-only Claude-managed plugin — discovered from ~/.claude or project .claude dirs */
export interface ClaudePlugin {
  slug: string;
  marketplace: string | null;
  scope: ClaudePluginScope;
  projectPath: string | null;
  version: string | null;
  gitCommitSha: string | null;
  installPath: string;
  source: "claude";
  managed: false;
}

export type InstalledSkillsResponse = {
  exists: boolean;
  dir: string;
  plugins: InstalledSkill[];
  claudePlugins: ClaudePlugin[];
};

export type SkillInstallStatus = "cloning" | "enabling" | "done" | "error";

export interface SkillInstallProgress {
  skillSlug: string;
  projectId: string;
  status: SkillInstallStatus;
  message?: string;
}

export interface ClaudeAgent {
  slug: string;
  name: string;
  model: string | null;
  description: string | null;
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
