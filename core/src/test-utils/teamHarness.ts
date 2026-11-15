import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runExecutor, type RunOptions } from "../agents/executor.js";
import { getComments } from "../services/commentService.js";
import {
  createProject,
  createTask,
  getProject,
  getTask,
  updateTask,
  type CreateProjectInput,
} from "../services/taskService.js";
import { listTeamArtifactsByTask, listTeamRunsByTask } from "../services/teamRunService.js";
import type { Project, Task } from "../types/index.js";
import { FAKE_CLAUDE, git, makeRepo, readCalls } from "./fakeRepo.js";

export interface TeamCase {
  repo: string;
  state: string;
  project: Project;
  task: Task;
  initialHead: string;
}

let counter = 0;
const created: string[] = [];

export function cleanupTeamCases(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export async function makeTeamCase(opts: {
  scenario?: string;
  project?: Partial<CreateProjectInput>;
  teamId?: string | null;
  title?: string;
  budgetUsd?: number | null;
  costUsd?: number;
  setupRepo?: (repo: string) => void;
}): Promise<TeamCase> {
  const repo = makeRepo();
  opts.setupRepo?.(repo);
  const state = mkdtempSync(join(tmpdir(), "clauflow-team-state-"));
  created.push(repo, state);
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_STATE = state;
  process.env.FAKE_CLAUDE_SCENARIO = opts.scenario ?? "pass";
  if (opts.costUsd !== undefined) process.env.FAKE_CLAUDE_COST_USD = String(opts.costUsd);
  else delete process.env.FAKE_CLAUDE_COST_USD;
  counter += 1;
  const slug = `tc${counter}${Date.now().toString(36)}`;
  const project = await createProject({
    name: `Team case ${slug}`,
    repoPath: repo,
    defaultBranch: "main",
    slug,
    ...opts.project,
  });
  let task = await createTask({
    projectId: project.id,
    title: opts.title ?? "Add slugify",
    description: "Add a slugify helper with tests.",
    teamId: opts.teamId ?? null,
  });
  if (opts.budgetUsd !== undefined) task = await updateTask(task.id, { budgetUsd: opts.budgetUsd });
  return { repo, state, project, task, initialHead: git(repo, "rev-parse", "HEAD") };
}

/** Moves the task to doing and runs the executor to completion (or pause). */
export async function runTeamCase(c: TeamCase, opts: RunOptions = {}): Promise<Task> {
  const doing = await updateTask(c.task.id, { status: "doing" });
  const project = (await getProject(c.project.id))!;
  await runExecutor(doing, project, opts);
  return (await getTask(c.task.id))!;
}

export function inspect(c: TeamCase) {
  const branches = git(c.repo, "branch", "--list", "feature/*")
    .split("\n")
    .map((b) => b.replace(/^[*+ ]+/, "").trim())
    .filter(Boolean);
  return {
    calls: readCalls(c.state),
    roles: readCalls(c.state).map((x) => `${x.role}:${x.round}`),
    currentBranch: git(c.repo, "rev-parse", "--abbrev-ref", "HEAD"),
    status: git(c.repo, "status", "--porcelain"),
    branches,
    branchLog: (branch: string) => git(c.repo, "log", "--format=%s", `main..${branch}`).split("\n").filter(Boolean),
    branchFiles: (branch: string) => git(c.repo, "diff", "--name-only", `main...${branch}`).split("\n").filter(Boolean),
    runs: listTeamRunsByTask(c.task.id),
    artifacts: listTeamArtifactsByTask(c.task.id),
    comments: getComments(c.task.id),
  };
}
