import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import {
  createProject,
  getProject,
  listProjects,
} from "../services/taskService.js";
import {
  initRepo,
  createGithubRepo,
  getRemoteUrl,
  commitAll,
} from "../services/gitService.js";

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  remote: z.string().nullable().optional(),
  createGithubRepo: z.boolean().optional(),
  repoName: z.string().optional(),
  isPrivate: z.boolean().optional(),
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

    const project = await createProject({
      name: data.name,
      description: data.description,
      repoPath: data.repoPath,
      defaultBranch: data.defaultBranch,
      remote,
    });

    res.status(201).json({ project, githubError });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
