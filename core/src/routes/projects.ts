import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
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
import {
  initRepo,
  createGithubRepo,
  deleteGithubRepo,
  getRemoteUrl,
  commitAll,
} from "../services/gitService.js";
import { runProjectPlanner } from "../agents/projectPlanner.js";
import { runCloneRepo } from "../agents/cloneRunner.js";

const router = Router();

const slugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      "slug yalnızca küçük harf, rakam ve tek tire içerebilir; başta/sonda tire olamaz",
  });

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
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const projects = await listProjects();
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const data = parsed.data;

    // repoPath mutlak olmalı
    if (!path.isAbsolute(data.repoPath)) {
      res.status(400).json({ error: "repoPath mutlak bir yol olmalıdır" });
      return;
    }

    // repoName (GitHub repo adı) için güvenli karakter kontrolü
    if (data.repoName && !/^[a-zA-Z0-9_.-]+$/.test(data.repoName)) {
      res
        .status(400)
        .json({ error: "repoName sadece harf, rakam, _ . - içerebilir" });
      return;
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
        githubError = (err as Error).message;
      }
    }

    const trimmedPrompt = data.aiPrompt?.trim();

    let project = await createProject({
      name: data.name,
      description: data.description,
      aiPrompt: trimmedPrompt,
      repoPath: data.repoPath,
      defaultBranch: data.defaultBranch,
      remote,
      slug: data.slug,
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

    res.status(201).json({ project, githubError });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const cloneProjectSchema = z.object({
  repoUrl: z.string().min(1),
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
    return res.status(400).json({ error: "targetPath mutlak bir yol olmalıdır" });
  }

  if (fs.existsSync(targetPath)) {
    try {
      const entries = fs.readdirSync(targetPath);
      if (entries.length > 0) {
        return res
          .status(409)
          .json({ error: "targetPath mevcut ve boş değil" });
      }
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  const projects = await listProjects();
  if (projects.some((p) => p.repoPath === targetPath)) {
    return res
      .status(409)
      .json({ error: "Bu yola sahip bir proje zaten mevcut" });
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
});

router.patch("/:id", async (req: Request, res: Response) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const id = req.params.id!;
    const existing = await getProject(id);
    if (!existing) return res.status(404).json({ error: "not_found" });

    const data = parsed.data;

    if (data.repoPath !== undefined && !path.isAbsolute(data.repoPath)) {
      return res.status(400).json({ error: "repoPath mutlak bir yol olmalıdır" });
    }

    if (data.repoPath !== undefined || data.defaultBranch !== undefined) {
      const hasActive = await projectHasActiveTasks(id);
      if (hasActive) {
        return res.status(409).json({ error: "active_tasks_block_path_change" });
      }
    }

    const trimmedPrompt = data.aiPrompt?.trim();
    const shouldRetryPlanning =
      existing.planningStatus === "error" &&
      trimmedPrompt !== undefined &&
      trimmedPrompt.length > 0;

    let project = await updateProject(id, data);

    if (shouldRetryPlanning) {
      project = await updateProject(id, { planningStatus: "planning" });
      runProjectPlanner(id, trimmedPrompt!, 8).catch((err) => {
        console.error("[projects] runProjectPlanner retry failed:", err);
      });
    }

    res.json({ project });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("Slug already in use")) {
      return res.status(409).json({ error: msg });
    }
    if (msg.startsWith("Invalid slug")) {
      return res.status(400).json({ error: msg });
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
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete("/:id/github", async (req: Request, res: Response) => {
  try {
    const id = req.params.id!;
    const project = await getProject(id);
    if (!project) return res.status(404).json({ error: "not_found" });

    if (!project.remote) {
      return res.status(400).json({ error: "no_remote" });
    }

    await deleteGithubRepo(project.remote);
    const updated = await updateProject(id, { remote: null });
    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
