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
  run,
} from "../services/gitService.js";
import { runProjectPlanner } from "../agents/projectPlanner.js";
import { runCloneRepo } from "../agents/cloneRunner.js";
import {
  listInstalled as cliListInstalled,
  listAvailable as cliListAvailable,
  installPlugin as cliInstallPlugin,
  uninstallPlugin as cliUninstallPlugin,
  enablePlugin as cliEnablePlugin,
  disablePlugin as cliDisablePlugin,
  listMarketplaces as cliListMarketplaces,
  addMarketplace as cliAddMarketplace,
  removeMarketplace as cliRemoveMarketplace,
} from "../services/claudePluginCli.js";
import { broadcastSkillInstallProgress } from "../services/wsService.js";

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

router.get("/:id/claude/instructions", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const file = path.join(project.repoPath, "CLAUDE.md");
    if (!fs.existsSync(file)) {
      return res.json({ exists: false, content: "", path: file });
    }
    const content = fs.readFileSync(file, "utf8");
    res.json({ exists: true, content, path: file });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const instructionsSchema = z.object({ content: z.string().max(500_000) });

router.put("/:id/claude/instructions", async (req: Request, res: Response) => {
  const parsed = instructionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    if (!fs.existsSync(project.repoPath)) {
      return res.status(400).json({ error: "repo_path_missing" });
    }

    const file = path.join(project.repoPath, "CLAUDE.md");
    fs.writeFileSync(file, parsed.data.content, "utf8");

    let committed = false;
    let commitSha: string | null = null;
    let commitWarning: string | null = null;

    if (fs.existsSync(path.join(project.repoPath, ".git"))) {
      const add = await run("git", ["add", "CLAUDE.md"], project.repoPath);
      if (add.code !== 0) {
        commitWarning = `git add failed: ${add.stderr || add.stdout}`.trim();
      } else {
        const status = await run(
          "git",
          ["diff", "--cached", "--name-only"],
          project.repoPath,
        );
        if (status.stdout.trim().length === 0) {
          commitWarning = "no_changes";
        } else {
          const commit = await run(
            "git",
            ["commit", "-m", "chore: update CLAUDE.md"],
            project.repoPath,
          );
          if (commit.code !== 0) {
            commitWarning = `git commit failed: ${commit.stderr || commit.stdout}`.trim();
          } else {
            committed = true;
            const sha = await run(
              "git",
              ["rev-parse", "--short", "HEAD"],
              project.repoPath,
            );
            commitSha = sha.code === 0 ? sha.stdout.trim() : null;
          }
        }
      }
    } else {
      commitWarning = "not_a_git_repo";
    }

    res.json({
      exists: true,
      content: parsed.data.content,
      path: file,
      committed,
      commitSha,
      commitWarning,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

async function pushCurrentBranch(repoPath: string, res: Response) {
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return res.status(400).json({ error: "not_a_git_repo" });
  }

  const remotes = await run("git", ["remote"], repoPath);
  if (remotes.stdout.trim() === "") {
    return res.status(400).json({ error: "no_remote" });
  }

  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
  if (branch.code !== 0) {
    return res.status(500).json({ error: `git rev-parse failed: ${branch.stderr || branch.stdout}` });
  }
  const branchName = branch.stdout.trim();

  const push = await run("git", ["push", "origin", branchName], repoPath);
  if (push.code !== 0) {
    return res.status(409).json({
      error: "push_failed",
      branch: branchName,
      detail: (push.stderr || push.stdout).trim(),
    });
  }

  return res.json({ pushed: true, branch: branchName });
}

router.post("/:id/claude/instructions/push", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    return pushCurrentBranch(project.repoPath, res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/:id/claude/push", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    return pushCurrentBranch(project.repoPath, res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

interface AgentFrontmatter {
  name?: string;
  model?: string;
  description?: string;
  [key: string]: string | undefined;
}

interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  body: string;
}

function parseAgentFile(raw: string): ParsedAgent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const fmRaw = match[1] ?? "";
  const body = match[2] ?? "";
  const frontmatter: AgentFrontmatter = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[m[1]!] = value;
  }
  return { frontmatter, body };
}

function serializeAgentFile(fm: AgentFrontmatter, body: string): string {
  const keys = ["name", "model", "description"] as const;
  const lines: string[] = ["---"];
  for (const k of keys) {
    const v = fm[k];
    if (v === undefined || v === "") continue;
    const safe = /[:#\n"']/.test(v) ? JSON.stringify(v) : v;
    lines.push(`${k}: ${safe}`);
  }
  lines.push("---", "");
  return lines.join("\n") + (body.startsWith("\n") ? body : `\n${body}`).replace(/^\n+/, "\n");
}

const agentSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug only lowercase letters, digits and single hyphens",
  });

const agentBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  model: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  body: z.string().max(200_000).optional(),
});

const agentCreateSchema = agentBodySchema.extend({
  slug: agentSlugSchema,
});

function agentsDir(repoPath: string): string {
  return path.join(repoPath, ".claude", "agents");
}

function agentFilePath(repoPath: string, slug: string): string {
  return path.join(agentsDir(repoPath), `${slug}.md`);
}

function settingsPath(repoPath: string): string {
  return path.join(repoPath, ".claude", "settings.json");
}

function isMinimalBootstrappedSettings(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed);
    if (!keys.every((k) => k === "env" || k === "permissions")) return false;

    const env = parsed.env ?? {};
    const envKeys = Object.keys(env);
    if (!envKeys.every((k) => k === "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")) return false;
    if (envKeys.length > 0 && env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS !== "1") return false;

    const perms = parsed.permissions ?? {};
    const permKeys = Object.keys(perms);
    if (!permKeys.every((k) => k === "defaultMode")) return false;
    if (permKeys.length > 0 && perms.defaultMode !== "bypassPermissions") return false;

    return true;
  } catch {
    return false;
  }
}

function ensureClaudeSettings(repoPath: string): { changed: boolean; path: string } {
  const file = settingsPath(repoPath);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  type SettingsShape = {
    env?: Record<string, string>;
    permissions?: { defaultMode?: string; allow?: string[]; [k: string]: unknown };
    [k: string]: unknown;
  };

  let current: SettingsShape = {};
  let raw = "";
  if (fs.existsSync(file)) {
    raw = fs.readFileSync(file, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        current = parsed as SettingsShape;
      }
    } catch {
      // corrupt or non-JSON — leave current as {} and overwrite
    }
  }

  const env = { ...(current.env ?? {}) };
  const permissions = { ...(current.permissions ?? {}) };

  let changed = false;
  if (env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS !== "1") {
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
    changed = true;
  }
  if (permissions.defaultMode !== "bypassPermissions") {
    permissions.defaultMode = "bypassPermissions";
    changed = true;
  }

  if (!changed && raw) return { changed: false, path: file };

  const next: SettingsShape = { ...current, env, permissions };
  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (serialized === raw) return { changed: false, path: file };

  fs.writeFileSync(file, serialized, "utf8");
  return { changed: true, path: file };
}

async function commitAgentChange(
  repoPath: string,
  relPath: string | string[],
  message: string,
): Promise<{ committed: boolean; commitSha: string | null; commitWarning: string | null }> {
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return { committed: false, commitSha: null, commitWarning: "not_a_git_repo" };
  }
  const paths = Array.isArray(relPath) ? relPath : [relPath];
  const add = await run("git", ["add", "--", ...paths], repoPath);
  if (add.code !== 0) {
    return {
      committed: false,
      commitSha: null,
      commitWarning: `git add failed: ${add.stderr || add.stdout}`.trim(),
    };
  }
  const status = await run("git", ["diff", "--cached", "--name-only"], repoPath);
  if (status.stdout.trim().length === 0) {
    return { committed: false, commitSha: null, commitWarning: "no_changes" };
  }
  const commit = await run("git", ["commit", "-m", message], repoPath);
  if (commit.code !== 0) {
    return {
      committed: false,
      commitSha: null,
      commitWarning: `git commit failed: ${commit.stderr || commit.stdout}`.trim(),
    };
  }
  const sha = await run("git", ["rev-parse", "--short", "HEAD"], repoPath);
  return {
    committed: true,
    commitSha: sha.code === 0 ? sha.stdout.trim() : null,
    commitWarning: null,
  };
}

router.get("/:id/claude/agents", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const dir = agentsDir(project.repoPath);
    if (!fs.existsSync(dir)) {
      return res.json({ exists: false, dir, agents: [] });
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();

    if (files.length > 0 && fs.existsSync(project.repoPath)) {
      const settings = ensureClaudeSettings(project.repoPath);
      if (settings.changed) {
        const rel = path.relative(project.repoPath, settings.path);
        await commitAgentChange(
          project.repoPath,
          rel,
          "chore(claude): bootstrap settings.json for agent team",
        );
      }
    }

    const agents = files.map((file) => {
      const slug = file.replace(/\.md$/, "");
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { frontmatter, body } = parseAgentFile(raw);
      return {
        slug,
        name: frontmatter.name ?? slug,
        model: frontmatter.model ?? null,
        description: frontmatter.description ?? null,
        body,
        path: path.join(dir, file),
      };
    });
    res.json({ exists: true, dir, agents });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/:id/claude/agents/:slug", async (req: Request, res: Response) => {
  const slugParse = agentSlugSchema.safeParse(req.params.slug);
  if (!slugParse.success) return res.status(400).json({ error: "invalid_slug" });
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const file = agentFilePath(project.repoPath, slugParse.data);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "agent_not_found" });
    const raw = fs.readFileSync(file, "utf8");
    const { frontmatter, body } = parseAgentFile(raw);
    res.json({
      slug: slugParse.data,
      name: frontmatter.name ?? slugParse.data,
      model: frontmatter.model ?? null,
      description: frontmatter.description ?? null,
      body,
      path: file,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/:id/claude/agents", async (req: Request, res: Response) => {
  const parsed = agentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    if (!fs.existsSync(project.repoPath)) {
      return res.status(400).json({ error: "repo_path_missing" });
    }

    const dir = agentsDir(project.repoPath);
    fs.mkdirSync(dir, { recursive: true });

    const file = agentFilePath(project.repoPath, parsed.data.slug);
    if (fs.existsSync(file)) {
      return res.status(409).json({ error: "agent_already_exists" });
    }

    const fm: AgentFrontmatter = {
      name: parsed.data.name ?? parsed.data.slug,
      model: parsed.data.model,
      description: parsed.data.description,
    };
    const content = serializeAgentFile(fm, parsed.data.body ?? "");
    fs.writeFileSync(file, content, "utf8");

    const settings = ensureClaudeSettings(project.repoPath);
    const rel = path.relative(project.repoPath, file);
    const paths = settings.changed
      ? [rel, path.relative(project.repoPath, settings.path)]
      : [rel];
    const commit = await commitAgentChange(
      project.repoPath,
      paths,
      `chore(agents): add ${parsed.data.slug}`,
    );

    res.status(201).json({
      slug: parsed.data.slug,
      name: fm.name ?? parsed.data.slug,
      model: fm.model ?? null,
      description: fm.description ?? null,
      body: parsed.data.body ?? "",
      path: file,
      ...commit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put("/:id/claude/agents/:slug", async (req: Request, res: Response) => {
  const slugParse = agentSlugSchema.safeParse(req.params.slug);
  if (!slugParse.success) return res.status(400).json({ error: "invalid_slug" });
  const parsed = agentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const file = agentFilePath(project.repoPath, slugParse.data);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "agent_not_found" });

    const existing = parseAgentFile(fs.readFileSync(file, "utf8"));
    const fm: AgentFrontmatter = {
      name: parsed.data.name ?? existing.frontmatter.name ?? slugParse.data,
      model: parsed.data.model ?? existing.frontmatter.model,
      description: parsed.data.description ?? existing.frontmatter.description,
    };
    const body = parsed.data.body ?? existing.body;
    fs.writeFileSync(file, serializeAgentFile(fm, body), "utf8");

    const rel = path.relative(project.repoPath, file);
    const commit = await commitAgentChange(
      project.repoPath,
      rel,
      `chore(agents): update ${slugParse.data}`,
    );

    res.json({
      slug: slugParse.data,
      name: fm.name ?? slugParse.data,
      model: fm.model ?? null,
      description: fm.description ?? null,
      body,
      path: file,
      ...commit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete("/:id/claude/agents/:slug", async (req: Request, res: Response) => {
  const slugParse = agentSlugSchema.safeParse(req.params.slug);
  if (!slugParse.success) return res.status(400).json({ error: "invalid_slug" });
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const file = agentFilePath(project.repoPath, slugParse.data);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "agent_not_found" });

    fs.unlinkSync(file);

    const paths: string[] = [path.relative(project.repoPath, file)];

    const dir = agentsDir(project.repoPath);
    const remaining = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
      : [];

    if (remaining.length === 0) {
      const settingsFile = settingsPath(project.repoPath);
      if (isMinimalBootstrappedSettings(settingsFile)) {
        fs.unlinkSync(settingsFile);
        paths.push(path.relative(project.repoPath, settingsFile));
      }
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    }

    const commit = await commitAgentChange(
      project.repoPath,
      paths,
      `chore(agents): delete ${slugParse.data}`,
    );

    res.json({ deleted: true, slug: slugParse.data, ...commit });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const pluginIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/, {
    message: "pluginId must be in the form <slug>@<marketplace>",
  });

const installBodySchema = z.object({
  scope: z.enum(["user", "project", "local"]).optional(),
});

const marketplaceAddSchema = z.object({
  source: z
    .string()
    .min(1)
    .max(500)
    .regex(
      /^(https?:\/\/[\w.\-/:@%?=&+#]+|[\w.-]+\/[\w.-]+|[\w.-]+)$/,
      "must be a URL, owner/repo shorthand, or name",
    ),
});

const marketplaceNameSchema = z.string().min(1).max(120);

router.get("/:id/claude/skills/registry", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    const available = await cliListAvailable(project.repoPath);
    res.json({ available });
  } catch (err) {
    console.error("[skills.registry]", err);
    res.status(500).json({ error: "registry_load_failed" });
  }
});

router.get("/:id/claude/skills", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    const installed = await cliListInstalled(project.repoPath);
    res.json({ installed });
  } catch (err) {
    console.error("[skills.list]", err);
    res.status(500).json({ error: "installed_list_failed" });
  }
});

router.post(
  "/:id/claude/skills/:pluginId/install",
  async (req: Request, res: Response) => {
    const idParse = pluginIdSchema.safeParse(req.params.pluginId);
    if (!idParse.success) return res.status(400).json({ error: "invalid_plugin_id" });
    const bodyParse = installBodySchema.safeParse(req.body ?? {});
    if (!bodyParse.success) {
      return res.status(400).json({ error: "invalid_body", issues: bodyParse.error.issues });
    }
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      const scope = bodyParse.data.scope ?? "local";
      const pluginId = idParse.data;

      res.status(202).json({ accepted: true, pluginId, scope });

      broadcastSkillInstallProgress(project.id, pluginId, "running", `installing ${pluginId}`);
      cliInstallPlugin(project.repoPath, pluginId, scope)
        .then(() => {
          broadcastSkillInstallProgress(project.id, pluginId, "done", `installed ${pluginId}`);
        })
        .catch((err: Error) => {
          console.error("[skills.install]", err);
          broadcastSkillInstallProgress(project.id, pluginId, "error", "install_failed");
        });
    } catch (err) {
      console.error("[skills.install]", err);
      res.status(500).json({ error: "install_failed" });
    }
  },
);

async function findInstalledScope(
  repoPath: string,
  pluginId: string,
): Promise<"user" | "project" | "local" | null> {
  const installed = await cliListInstalled(repoPath);
  const entry = installed.find((p) => p.id === pluginId);
  return entry ? entry.scope : null;
}

router.delete(
  "/:id/claude/skills/:pluginId",
  async (req: Request, res: Response) => {
    const idParse = pluginIdSchema.safeParse(req.params.pluginId);
    if (!idParse.success) return res.status(400).json({ error: "invalid_plugin_id" });
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      const scope = await findInstalledScope(project.repoPath, idParse.data);
      if (!scope) return res.status(404).json({ error: "plugin_not_installed" });
      await cliUninstallPlugin(project.repoPath, idParse.data, scope);
      res.json({ deleted: true, pluginId: idParse.data, scope });
    } catch (err) {
      console.error("[skills.uninstall]", err);
      res.status(500).json({ error: "uninstall_failed" });
    }
  },
);

router.post(
  "/:id/claude/skills/:pluginId/enable",
  async (req: Request, res: Response) => {
    const idParse = pluginIdSchema.safeParse(req.params.pluginId);
    if (!idParse.success) return res.status(400).json({ error: "invalid_plugin_id" });
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      const scope = await findInstalledScope(project.repoPath, idParse.data);
      if (!scope) return res.status(404).json({ error: "plugin_not_installed" });
      await cliEnablePlugin(project.repoPath, idParse.data, scope);
      res.json({ enabled: true, pluginId: idParse.data, scope });
    } catch (err) {
      console.error("[skills.enable]", err);
      res.status(500).json({ error: "enable_failed" });
    }
  },
);

router.post(
  "/:id/claude/skills/:pluginId/disable",
  async (req: Request, res: Response) => {
    const idParse = pluginIdSchema.safeParse(req.params.pluginId);
    if (!idParse.success) return res.status(400).json({ error: "invalid_plugin_id" });
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      const scope = await findInstalledScope(project.repoPath, idParse.data);
      if (!scope) return res.status(404).json({ error: "plugin_not_installed" });
      await cliDisablePlugin(project.repoPath, idParse.data, scope);
      res.json({ enabled: false, pluginId: idParse.data, scope });
    } catch (err) {
      console.error("[skills.disable]", err);
      res.status(500).json({ error: "disable_failed" });
    }
  },
);

router.get("/:id/claude/marketplaces", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    const marketplaces = await cliListMarketplaces(project.repoPath);
    res.json({ marketplaces });
  } catch (err) {
    console.error("[marketplaces.list]", err);
    res.status(500).json({ error: "marketplace_list_failed" });
  }
});

router.post("/:id/claude/marketplaces", async (req: Request, res: Response) => {
  const parsed = marketplaceAddSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    await cliAddMarketplace(project.repoPath, parsed.data.source);
    res.status(201).json({ added: true, source: parsed.data.source });
  } catch (err) {
    console.error("[marketplaces.add]", err);
    res.status(500).json({ error: "marketplace_add_failed" });
  }
});

router.delete(
  "/:id/claude/marketplaces/:name",
  async (req: Request, res: Response) => {
    const nameParse = marketplaceNameSchema.safeParse(req.params.name);
    if (!nameParse.success) return res.status(400).json({ error: "invalid_name" });
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      await cliRemoveMarketplace(project.repoPath, nameParse.data);
      res.json({ deleted: true, name: nameParse.data });
    } catch (err) {
      console.error("[marketplaces.remove]", err);
      res.status(500).json({ error: "marketplace_remove_failed" });
    }
  },
);

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
