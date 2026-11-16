import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { errorMessage } from "../utils/error.js";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isGitRepo(repoPath: string): boolean {
  return fs.existsSync(path.join(path.resolve(expandHome(repoPath)), ".git"));
}

async function ensureLocalRepo(repoPath: string, branch: string, name: string): Promise<void> {
  fs.mkdirSync(repoPath, { recursive: true });
  if (fs.existsSync(path.join(repoPath, ".git"))) return;

  const init = await initRepo(repoPath, branch);
  if (init.code !== 0) {
    throw new Error(`git init failed: ${init.stderr || init.stdout}`);
  }

  const readmePath = path.join(repoPath, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# ${name}\n`);
  }

  const commit = await commitAll(repoPath, "chore: initial commit");
  if (commit.code !== 0) {
    throw new Error(`initial commit failed: ${commit.stderr || commit.stdout}`);
  }
}

function normalizeClonePath(raw: string): string {
  const expanded = expandHome(raw.trim());
  if (!path.isAbsolute(expanded)) return expanded;
  const resolved = path.resolve(expanded);
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  projectHasActiveTasks,
  updateProject,
} from "../services/taskService.js";
import { dropStash, listClauflowStashes, restoreStash, StashError } from "../services/stashService.js";
import {
  initRepo,
  createGithubRepo,
  getRemoteUrl,
  commitAll,
  run,
} from "../services/gitService.js";
import { runProjectPlanner } from "../agents/projectPlanner.js";
import { assertTeamUsableByProject, TeamServiceError } from "../services/teamService.js";
import { runCloneRepo } from "../agents/cloneRunner.js";
import { invalidateHasRemote, withHasRemote, withHasRemoteAll } from "../services/remoteInfo.js";
import { baseBranchExists, detectBaseBranch, repoHasCommits } from "../services/baseBranch.js";

/**
 * zincir F0.5 (plan §5.0): an existing repo with commits must carry the given
 * base branch. Returns the 422 body (with a `detected` hint) or null. A repo
 * without commits (unborn branch) or a missing path is not checked here.
 */
async function baseBranchProblem(
  repoPath: string,
  branch: string,
): Promise<{ error: "base_branch_missing"; detected: string | null } | null> {
  const resolved = path.resolve(expandHome(repoPath));
  if (!fs.existsSync(path.join(resolved, ".git"))) return null;
  if (!(await repoHasCommits(resolved))) return null;
  if (await baseBranchExists(resolved, branch)) return null;
  return { error: "base_branch_missing", detected: await detectBaseBranch(resolved) };
}

const router = Router();

const slugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: "invalid_slug" });

/** A bad slug answers `invalid_slug`; any other schema failure `invalid_body`. */
function invalidBody(res: Response, error: z.ZodError) {
  const slugIssue = error.issues.some((i) => i.path[0] === "slug");
  return res
    .status(400)
    .json({ error: slugIssue ? "invalid_slug" : "invalid_body", issues: error.issues });
}

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  remote: z.string().nullable().optional(),
  createGithubRepo: z.boolean().optional(),
  repoName: z.string().optional(),
  isPrivate: z.boolean().optional(),
  aiPrompt: z.string().optional(),
  maxTasks: z.number().int().positive().max(20).optional(),
  slug: slugSchema.optional(),
  budgetUsd: z.number().min(0.1).nullable().optional(),
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const projects = await withHasRemoteAll(await listProjects());
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/git-status", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const cwd = project.repoPath;
    try {
      execFileSync("git", ["-C", cwd, "rev-parse", "--git-dir"], { stdio: "ignore" });
      const branch = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const porcelain = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
        encoding: "utf8",
      });
      const isDirty = porcelain.trim().length > 0;
      res.json({ branch, isDirty });
    } catch {
      res.json({ branch: null, isDirty: false });
    }
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// zincir E6 (plan §3/26–27, §5.9): ClauFlow's stashes in the project repo.
// Addressed by stash commit SHA; restore/drop never wait for the repo lock.
const stashRefSchema = z.string().regex(/^[0-9a-f]{40}$/i);

function sendStashError(res: Response, err: unknown): Response {
  if (err instanceof StashError) {
    const status = err.code === "stash_not_found" ? 404 : 409;
    return res
      .status(status)
      .json({ error: err.code, ...(err.code === "stash_conflict" ? { files: err.extra.files ?? [] } : {}) });
  }
  return res.status(500).json({ error: errorMessage(err) });
}

router.get("/:id/stashes", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json({ stashes: await listClauflowStashes(project.repoPath) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/:id/stashes/:ref/restore", async (req: Request, res: Response) => {
  const ref = stashRefSchema.safeParse(req.params.ref);
  if (!ref.success) return res.status(400).json({ error: "invalid_body", issues: ref.error.issues });
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json(await restoreStash(project.repoPath, ref.data.toLowerCase()));
  } catch (err) {
    sendStashError(res, err);
  }
});

router.delete("/:id/stashes/:ref", async (req: Request, res: Response) => {
  const ref = stashRefSchema.safeParse(req.params.ref);
  if (!ref.success) return res.status(400).json({ error: "invalid_body", issues: ref.error.issues });
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    await dropStash(project.repoPath, ref.data.toLowerCase());
    res.status(204).end();
  } catch (err) {
    sendStashError(res, err);
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json({ project: await withHasRemote(project) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res, parsed.error);
  try {
    const data = parsed.data;

    if (!path.isAbsolute(data.repoPath)) {
      res.status(400).json({ error: "repo_path_not_absolute" });
      return;
    }

    if (path.resolve(data.repoPath).split(path.sep).filter(Boolean).length < 2) {
      res.status(400).json({ error: "repo_path_too_shallow" });
      return;
    }

    if (data.repoName && !/^[a-zA-Z0-9_.-]+$/.test(data.repoName)) {
      res.status(400).json({ error: "invalid_repo_name" });
      return;
    }

    // An existing repo keeps its branches: never record a base it lacks.
    if (data.defaultBranch) {
      const problem = await baseBranchProblem(data.repoPath, data.defaultBranch);
      if (problem) return res.status(422).json(problem);
    }

    if (!data.createGithubRepo) {
      await ensureLocalRepo(data.repoPath, data.defaultBranch ?? "main", data.name);
    }

    let remote = data.remote ?? null;
    let githubError: string | null = null;

    if (data.createGithubRepo === true) {
      const repoName = data.repoName ?? data.name;
      const isPrivate = data.isPrivate ?? true;
      try {
        if (!fs.existsSync(data.repoPath)) {
          fs.mkdirSync(data.repoPath, { recursive: true });
        }

        if (!fs.existsSync(path.join(data.repoPath, ".git"))) {
          const init = await initRepo(data.repoPath);
          if (init.code !== 0) {
            throw new Error(`git init failed: ${init.stderr || init.stdout}`);
          }
        }

        const readmePath = path.join(data.repoPath, "README.md");
        if (!fs.existsSync(readmePath)) {
          fs.writeFileSync(readmePath, `# ${data.name}\n`);
        }

        const commit = await commitAll(data.repoPath, "chore: initial commit");
        if (commit.code !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
          throw new Error(`initial commit failed: ${commit.stderr || commit.stdout}`);
        }

        const created = await createGithubRepo(data.repoPath, repoName, isPrivate);
        if (created.code !== 0) {
          throw new Error(`gh repo create failed: ${created.stderr || created.stdout}`);
        }

        remote = await getRemoteUrl(data.repoPath);
      } catch (err) {
        githubError = errorMessage(err);
      }
    }

    const trimmedPrompt = data.aiPrompt?.trim();

    let detectedBranch = data.defaultBranch;
    if (!detectedBranch) {
      const headRef = await run("git", ["symbolic-ref", "--short", "HEAD"], data.repoPath);
      if (headRef.code === 0 && headRef.stdout.trim().length > 0) {
        detectedBranch = headRef.stdout.trim();
      }
    }

    let project = await createProject({
      name: data.name,
      description: data.description,
      aiPrompt: trimmedPrompt,
      repoPath: data.repoPath,
      defaultBranch: detectedBranch,
      remote,
      slug: data.slug,
      budgetUsd: data.budgetUsd,
    });

    if (trimmedPrompt) {
      project = await updateProject(project.id, { planningStatus: "planning" });
      runProjectPlanner(
        project.id,
        trimmedPrompt,
        data.maxTasks ?? 8,
      ).catch((err) => {
        console.error("[projects] runProjectPlanner failed:", err);
      });
    }

    invalidateHasRemote(project.repoPath);
    res.status(201).json({ project: await withHasRemote(project), githubError });
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

const cloneProjectSchema = z.object({
  repoUrl: z
    .string()
    .min(1)
    .regex(
      /^(https?:\/\/|git@)/,
      "repoUrl must start with https:// or git@ (SSH)",
    ),
  targetPath: z.string().min(1),
  name: z.string().min(1),
});

router.post("/clone", async (req: Request, res: Response) => {
  const parsed = cloneProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const { repoUrl, name } = parsed.data;
  const targetPath = normalizeClonePath(parsed.data.targetPath);

  if (!path.isAbsolute(targetPath)) {
    return res.status(400).json({ error: "target_path_not_absolute" });
  }

  if (fs.existsSync(targetPath)) {
    try {
      const entries = fs.readdirSync(targetPath);
      if (entries.length > 0) {
        return res.status(409).json({ error: "target_path_not_empty" });
      }
    } catch (err) {
      return res.status(400).json({ error: errorMessage(err) });
    }
  }

  const projects = await listProjects();
  if (projects.some((p) => p.repoPath === targetPath)) {
    return res.status(409).json({ error: "project_path_exists" });
  }

  runCloneRepo({ repoUrl, targetPath, name }).catch((err) => {
    console.error("[projects] runCloneRepo failed:", err);
  });

  res.status(202).json({ status: "cloning", targetPath });
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  aiPrompt: z.string().optional(),
  repoPath: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
  slug: slugSchema.optional(),
  budgetUsd: z.number().min(0.1).nullable().optional(),
  defaultTeamId: z.string().min(1).nullable().optional(),
  qaMaxRounds: z.number().int().min(0).max(20).optional(),
  specApproval: z.boolean().optional(),
});

router.patch("/:id", async (req: Request, res: Response) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res, parsed.error);
  try {
    const id = req.params.id!;
    const existing = await getProject(id);
    if (!existing) return res.status(404).json({ error: "not_found" });

    const data = parsed.data;

    if (data.defaultTeamId) {
      try {
        assertTeamUsableByProject(data.defaultTeamId, id);
      } catch (err) {
        if (err instanceof TeamServiceError) return res.status(400).json({ error: err.code });
        throw err;
      }
    }

    if (data.repoPath !== undefined && !path.isAbsolute(data.repoPath)) {
      return res.status(400).json({ error: "repo_path_not_absolute" });
    }

    if (data.repoPath !== undefined && !isGitRepo(data.repoPath)) {
      return res.status(400).json({ error: "repo_path_not_git" });
    }

    if (data.repoPath !== undefined || data.defaultBranch !== undefined) {
      const hasActive = await projectHasActiveTasks(id);
      if (hasActive) {
        return res.status(409).json({ error: "active_tasks_block_path_change" });
      }
      const problem = await baseBranchProblem(
        data.repoPath ?? existing.repoPath,
        data.defaultBranch ?? existing.defaultBranch,
      );
      if (problem) return res.status(422).json(problem);
    }

    const trimmedPrompt = data.aiPrompt?.trim();
    const shouldRetryPlanning =
      existing.planningStatus === "error" &&
      trimmedPrompt !== undefined &&
      trimmedPrompt.length > 0;

    let project = await updateProject(id, { ...data, budgetUsd: data.budgetUsd });

    if (shouldRetryPlanning) {
      project = await updateProject(id, { planningStatus: "planning" });
      runProjectPlanner(id, trimmedPrompt!, 8).catch((err) => {
        console.error("[projects] runProjectPlanner retry failed:", err);
      });
    }

    if (data.repoPath !== undefined) {
      invalidateHasRemote(existing.repoPath);
      invalidateHasRemote(project.repoPath);
    }
    res.json({ project: await withHasRemote(project) });
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.startsWith("Slug already in use")) {
      return res.status(409).json({ error: "slug_in_use" });
    }
    if (msg.startsWith("Invalid slug")) {
      return res.status(400).json({ error: "invalid_slug" });
    }
    res.status(500).json({ error: msg });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id!;
    const existing = await getProject(id);
    if (!existing) return res.status(404).json({ error: "not_found" });

    await deleteProject(id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
