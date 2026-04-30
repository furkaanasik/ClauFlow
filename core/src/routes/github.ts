import { Router, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getProject,
  listProjects,
  listTasks,
  updateTask,
} from "../services/taskService.js";
import { broadcastTaskUpdated } from "../services/wsService.js";
import type { Project } from "../types/index.js";

const execFileAsync = promisify(execFile);

/** Validate that a route param is a positive integer string (e.g. "42"). */
function validatePRNumber(raw: string): boolean {
  return /^\d+$/.test(raw) && Number(raw) > 0;
}

async function resolveProject(
  req: Request,
  res: Response,
): Promise<Project | null> {
  const { projectId } = req.query as { projectId?: string };
  if (!projectId) {
    res.status(400).json({ error: "projectId query param required" });
    return null;
  }
  const project = await getProject(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return project;
}

function handleGhError(err: unknown, res: Response, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not logged into") ||
    message.includes("GITHUB_TOKEN") ||
    message.includes("401") ||
    message.includes("gh auth")
  ) {
    res.status(401).json({ error: "GitHub kimlik dogrulamasi yapilmamis" });
    return;
  }
  console.error(`[github] ${context} error:`, message);
  res.status(500).json({ error: message });
}

const router = Router();

interface GhRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  sshUrl: string;
  visibility: string;
  updatedAt: string;
}

function normalizeRemote(remote: string): string {
  return remote.replace(/\.git$/, "").toLowerCase();
}

router.get("/repos", async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "repo",
        "list",
        "--json",
        "name,nameWithOwner,description,sshUrl,url,visibility,updatedAt",
        "--limit",
        "100",
      ],
    );

    const ghRepos = JSON.parse(stdout) as GhRepo[];
    const projects = await listProjects();

    const repos = ghRepos.map((repo) => {
      const candidates = [repo.url, repo.sshUrl].map(normalizeRemote);
      const matched = projects.find((p) => {
        if (!p.remote) return false;
        return candidates.includes(normalizeRemote(p.remote));
      });
      return matched
        ? { ...repo, isLocal: true, localPath: matched.repoPath }
        : { ...repo, isLocal: false };
    });

    res.json({ repos });
  } catch (err: unknown) {
    handleGhError(err, res, "repo list");
  }
});

router.get("/prs", async (req: Request, res: Response) => {
  const project = await resolveProject(req, res);
  if (!project) return;

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "list", "--json", "number,title,state,author,url,createdAt", "--limit", "50"],
      { cwd: project.repoPath },
    );

    const prs = JSON.parse(stdout) as unknown;
    res.json(prs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("no git remotes") || message.includes("not a git repository")) {
      res.status(422).json({ error: "Bu proje bir GitHub remote'una bagli degil" });
      return;
    }

    handleGhError(err, res, "pr list");
  }
});

router.get("/prs/:number/details", async (req: Request, res: Response) => {
  const prNumber = req.params.number;

  if (!prNumber || !validatePRNumber(prNumber)) {
    res.status(400).json({ error: "PR number must be a positive integer" });
    return;
  }

  const project = await resolveProject(req, res);
  if (!project) return;

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", prNumber, "--json", "files,title,body,additions,deletions,commits"],
      { cwd: project.repoPath },
    );

    const details = JSON.parse(stdout) as unknown;
    res.json(details);
  } catch (err: unknown) {
    handleGhError(err, res, "pr details");
  }
});

router.get("/prs/:number/diff", async (req: Request, res: Response) => {
  const prNumber = req.params.number;

  if (!prNumber || !validatePRNumber(prNumber)) {
    res.status(400).json({ error: "PR number must be a positive integer" });
    return;
  }

  const project = await resolveProject(req, res);
  if (!project) return;

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "diff", prNumber],
      { cwd: project.repoPath },
    );

    res.json({ diff: stdout });
  } catch (err: unknown) {
    handleGhError(err, res, "pr diff");
  }
});

router.post("/prs/:number/merge", async (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };
  const prNumber = req.params.number;

  if (!prNumber || !validatePRNumber(prNumber)) {
    res.status(400).json({ error: "PR number must be a positive integer" });
    return;
  }

  const project = await resolveProject(req, res);
  if (!project) return;

  try {
    await execFileAsync(
      "gh",
      ["pr", "merge", prNumber, "--merge"],
      { cwd: project.repoPath },
    );

    // prNumber ile eşleşen task'ı done'a taşı
    const tasks = await listTasks();
    const matched = tasks.find(
      (t) => t.projectId === projectId && t.prNumber === parseInt(prNumber, 10),
    );
    if (matched && matched.status !== "done") {
      const updated = await updateTask(matched.id, {
        status: "done",
        agent: { status: "done", currentStep: "completed", finishedAt: new Date().toISOString() },
      });
      broadcastTaskUpdated(updated);
    }

    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes("already merged") ||
      /Pull request #\d+.*is already merged/i.test(message)
    ) {
      res.status(409).json({ error: "Already merged" });
      return;
    }

    handleGhError(err, res, "pr merge");
  }
});

export default router;
