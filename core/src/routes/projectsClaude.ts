import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getProject } from "../services/taskService.js";
import { run } from "../services/gitService.js";
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
  cleanupOrphanCache as cliCleanupOrphanCache,
} from "../services/claudePluginCli.js";
import {
  broadcastSkillInstallProgress,
  broadcastStudioGeneration,
} from "../services/wsService.js";
import { runClaude } from "../services/claudeService.js";
import { syncTopologyToClaudeMd } from "../services/claudeTopologySyncService.js";
import {
  agentFilePath as gsAgentFilePath,
  agentsDir as gsAgentsDir,
  graphFilePath as gsGraphFilePath,
  graphSchema as gsGraphSchema,
  parseAgentFile as gsParseAgentFile,
  serializeAgentFile as gsSerializeAgentFile,
  type AgentFrontmatter as GsAgentFrontmatter,
  type ParsedAgent as GsParsedAgent,
} from "../services/graphService.js";
import type { AgentGraph } from "../types/index.js";
import { errorMessage } from "../utils/error.js";

const router = Router();

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
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/:id/claude/push", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    return pushCurrentBranch(project.repoPath, res);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

type AgentFrontmatter = GsAgentFrontmatter;
type ParsedAgent = GsParsedAgent;
const parseAgentFile = gsParseAgentFile;
const serializeAgentFile = gsSerializeAgentFile;

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
  allowedTools: z.string().max(500).optional(),
  body: z.string().max(200_000).optional(),
});

const agentCreateSchema = agentBodySchema.extend({
  slug: agentSlugSchema,
});

const agentsDir = gsAgentsDir;
const agentFilePath = gsAgentFilePath;

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
        allowedTools: frontmatter.allowedTools ?? null,
        body,
        path: path.join(dir, file),
      };
    });
    res.json({ exists: true, dir, agents });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
      allowedTools: frontmatter.allowedTools ?? null,
      body,
      path: file,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

const studioGenerateSchema = z.object({
  prompt: z.string().min(1).max(20_000),
  skills: z.array(z.string().min(1).max(200)).max(50).optional(),
});

function buildStudioSystemPrompt(userPrompt: string, skills: string[]): string {
  const skillsSection =
    skills.length > 0
      ? `\n\nThe agent has access to the following skills (Soft mode — they may be used when relevant). Append a section titled "## Available Skills" to the agent body containing a markdown table with columns "Skill" and "Description". Use the skill names below as the "Skill" column and a brief description for each.\n\nSkills:\n${skills.map((s) => `- ${s}`).join("\n")}`
      : "";
  return `You are generating a Claude Code subagent definition file.

Output ONLY the raw markdown for the agent file: a YAML frontmatter block delimited by --- lines (with at minimum: name, description), followed by the markdown body that defines the agent's role, responsibilities, and behavior.

Strict rules:
- Do NOT wrap the output in code fences (no \`\`\` markers).
- Do NOT include any preamble, explanation, or trailing commentary.
- Do NOT include a \`tools:\` field in the frontmatter.
- The first line of your output must be \`---\`.
- The frontmatter must include a \`name\` and a \`description\`.

User request for the agent:
${userPrompt}${skillsSection}`;
}

router.post(
  "/:id/claude/agents/studio/generate",
  async (req: Request, res: Response) => {
    const parsed = studioGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_body", issues: parsed.error.issues });
    }
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      if (!fs.existsSync(project.repoPath)) {
        return res.status(400).json({ error: "repo_path_missing" });
      }

      const generationId = `gen_${randomUUID().slice(0, 8)}`;
      const skills = parsed.data.skills ?? [];
      const systemPrompt = buildStudioSystemPrompt(parsed.data.prompt, skills);

      let markdown = "";
      try {
        const result = await runClaude({
          prompt: systemPrompt,
          cwd: project.repoPath,
          outputFormat: "stream-json",
          onText: (text) => {
            markdown += text;
            broadcastStudioGeneration({
              generationId,
              status: "running",
              chunk: text,
            });
          },
        });
        if (result.code !== 0) {
          const error = (result.stderr || result.stdout || "claude_failed").trim();
          broadcastStudioGeneration({ generationId, status: "error", error });
          return res.status(500).json({ error: "claude_failed", detail: error });
        }
      } catch (err) {
        const error = errorMessage(err);
        broadcastStudioGeneration({ generationId, status: "error", error });
        return res.status(500).json({ error: "claude_failed", detail: error });
      }

      broadcastStudioGeneration({ generationId, status: "done" });
      res.json({ generationId, markdown });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

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
      allowedTools: parsed.data.allowedTools,
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
      allowedTools: fm.allowedTools ?? null,
      body: parsed.data.body ?? "",
      path: file,
      ...commit,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
      allowedTools:
        parsed.data.allowedTools ?? existing.frontmatter.allowedTools,
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
      allowedTools: fm.allowedTools ?? null,
      body,
      path: file,
      ...commit,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

const graphFilePath = gsGraphFilePath;

function listAgentSlugs(repoPath: string): string[] {
  const dir = agentsDir(repoPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "_graph.json")
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

function loadAgentMeta(
  repoPath: string,
  slugs: string[],
): Array<{ slug: string; name: string }> {
  return slugs.map((slug) => {
    const file = agentFilePath(repoPath, slug);
    if (!fs.existsSync(file)) return { slug, name: slug };
    const { frontmatter } = parseAgentFile(fs.readFileSync(file, "utf8"));
    return { slug, name: frontmatter.name ?? slug };
  });
}

function deriveDefaultGraph(slugs: string[]): AgentGraph {
  return {
    nodes: slugs.map((slug, i) => ({
      id: slug,
      type: "agent" as const,
      position: { x: (i % 4) * 240, y: Math.floor(i / 4) * 160 },
      data: { slug },
    })),
    edges: [],
  };
}

const graphSchema = gsGraphSchema;

router.get("/:id/claude/graph", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const file = graphFilePath(project.repoPath);
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, "utf8");
        const parsed = graphSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return res.json(parsed.data);
      } catch {
        // fall through to derive
      }
    }
    const slugs = listAgentSlugs(project.repoPath);
    res.json(deriveDefaultGraph(slugs));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put("/:id/claude/graph", async (req: Request, res: Response) => {
  const parsed = graphSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    if (!fs.existsSync(project.repoPath)) {
      return res.status(400).json({ error: "repo_path_missing" });
    }

    const dir = agentsDir(project.repoPath);
    fs.mkdirSync(dir, { recursive: true });

    const file = graphFilePath(project.repoPath);
    const tmp = `${file}.tmp`;
    const json = JSON.stringify(parsed.data, null, 2);
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, file);

    const slugs = listAgentSlugs(project.repoPath);
    const agentMeta = loadAgentMeta(project.repoPath, slugs);
    await syncTopologyToClaudeMd(project.repoPath, parsed.data, agentMeta);

    res.json(parsed.data);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
): Promise<{ scope: "user" | "project" | "local"; cwd: string } | null> {
  const installed = await cliListInstalled(repoPath);
  const entry = installed.find((p) => p.id === pluginId);
  if (!entry) return null;
  const cwd = entry.scope === "local" && entry.projectPath ? entry.projectPath : repoPath;
  return { scope: entry.scope, cwd };
}

router.delete(
  "/:id/claude/skills/:pluginId",
  async (req: Request, res: Response) => {
    const idParse = pluginIdSchema.safeParse(req.params.pluginId);
    if (!idParse.success) return res.status(400).json({ error: "invalid_plugin_id" });
    try {
      const project = await getProject(req.params.id!);
      if (!project) return res.status(404).json({ error: "not_found" });
      const found = await findInstalledScope(project.repoPath, idParse.data);
      if (!found) {
        await cliCleanupOrphanCache(idParse.data);
        return res.json({ deleted: true, pluginId: idParse.data, scope: "orphan" });
      }
      await cliUninstallPlugin(found.cwd, idParse.data, found.scope);
      res.json({ deleted: true, pluginId: idParse.data, scope: found.scope });
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
      const found = await findInstalledScope(project.repoPath, idParse.data);
      if (!found) return res.status(404).json({ error: "plugin_not_installed" });
      await cliEnablePlugin(found.cwd, idParse.data, found.scope);
      res.json({ enabled: true, pluginId: idParse.data, scope: found.scope });
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
      const found = await findInstalledScope(project.repoPath, idParse.data);
      if (!found) return res.status(404).json({ error: "plugin_not_installed" });
      await cliDisablePlugin(found.cwd, idParse.data, found.scope);
      res.json({ enabled: false, pluginId: idParse.data, scope: found.scope });
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

export default router;
