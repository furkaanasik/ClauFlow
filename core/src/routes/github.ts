import { Router, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  createTask,
  getProject,
  listProjects,
  listTasks,
  updateTask,
} from "../services/taskService.js";
import { broadcastTaskCreated, broadcastTaskUpdated } from "../services/wsService.js";
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

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string; color: string }[];
  state: string;
}

router.get("/issues", async (req: Request, res: Response) => {
  const project = await resolveProject(req, res);
  if (!project) return;

  if (!project.remote) {
    res.status(422).json({ error: "Bu proje bir GitHub remote'una bagli degil" });
    return;
  }

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "list", "--json", "number,title,body,labels,state", "--limit", "50", "--state", "open"],
      { cwd: project.repoPath },
    );
    const issues = JSON.parse(stdout) as GhIssue[];
    res.json({ issues });
  } catch (err: unknown) {
    handleGhError(err, res, "issue list");
  }
});

const importIssuesSchema = z.object({
  projectId: z.string().min(1),
  issues: z.array(z.object({
    number: z.number(),
    title: z.string().min(1),
    body: z.string(),
  })).min(1),
});

router.post("/issues/import", async (req: Request, res: Response) => {
  const parsed = importIssuesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const { projectId, issues } = parsed.data;

  const project = await getProject(projectId);
  if (!project) {
    res.status(404).json({ error: "Proje bulunamadi" });
    return;
  }

  try {
    const created = await Promise.all(
      issues.map((issue) =>
        createTask({
          projectId,
          title: issue.title,
          description: issue.body,
        }).then((task) => { broadcastTaskCreated(task); return task; })
      )
    );
    res.status(201).json({ tasks: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const createIssueSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
});

router.post("/issues/create", async (req: Request, res: Response) => {
  const parsed = createIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }

  const project = await getProject(parsed.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Proje bulunamadi" });
    return;
  }

  if (!project.remote) {
    res.status(422).json({ error: "Bu proje bir GitHub remote'una bagli degil" });
    return;
  }

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "create", "--title", parsed.data.title, "--body", parsed.data.body || ""],
      { cwd: project.repoPath },
    );
    const url = stdout.trim();
    const match = url.match(/\/issues\/(\d+)$/);
    const number = match?.[1] ? parseInt(match[1], 10) : null;

    const ownerMatch = project.remote.match(/github\.com[/:]([\w.-]+)\//);
    const owner = ownerMatch?.[1];
    if (owner && url) {
      execFileAsync(
        "gh",
        ["project", "list", "--owner", owner, "--format", "json", "--limit", "1"],
        { cwd: project.repoPath },
      ).then(({ stdout: projOut }) => {
        const data = JSON.parse(projOut) as { projects: { number: number }[] };
        if (data.projects?.length > 0 && data.projects[0]) {
          return execFileAsync(
            "gh",
            ["project", "item-add", String(data.projects[0].number), "--owner", owner, "--url", url],
            { cwd: project.repoPath },
          );
        }
      }).catch(() => {});
    }

    res.status(201).json({ url, number });
  } catch (err: unknown) {
    handleGhError(err, res, "issue create");
  }
});

export default router;
