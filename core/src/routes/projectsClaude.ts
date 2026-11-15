import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { getProject } from "../services/taskService.js";
import { run } from "../services/gitService.js";
import { tryAcquireRepoLock } from "../services/repoLock.js";
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
import { broadcastSkillInstallProgress } from "../services/wsService.js";
import { errorMessage } from "../utils/error.js";
import { defaultSkillRoots, getSkillCatalog } from "../services/skillCatalogService.js";

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

    // A1g: never write into a working tree a run/comment/merge is using.
    const lease = tryAcquireRepoLock(project.repoPath, `claude-md:${project.id}`);
    if (!lease) return res.status(409).json({ error: "repo_busy" });

    const file = path.join(project.repoPath, "CLAUDE.md");
    let committed = false;
    let commitSha: string | null = null;
    let commitWarning: string | null = null;
    try {
      fs.writeFileSync(file, parsed.data.content, "utf8");

      const head = fs.existsSync(path.join(project.repoPath, ".git"))
        ? await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], project.repoPath)
        : null;

      if (head && (head.code !== 0 || head.stdout.trim() !== project.defaultBranch)) {
        commitWarning = "not_on_default_branch";
      } else if (head) {
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
    } finally {
      lease.release();
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

router.get("/:id/claude/skills/catalog", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });
    const skills = await getSkillCatalog(defaultSkillRoots(project.repoPath));
    res.json({ skills });
  } catch (err) {
    console.error("[skills.catalog]", err);
    res.status(500).json({ error: "skill_catalog_failed" });
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

interface SkillItem {
  id: string;
  source: "user" | "plugin" | "command";
  pluginId?: string;
}

router.get("/:id/claude/skills/installed-skills", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "not_found" });

    const skillMap = new Map<string, SkillItem>();

    const userSkillsDir = path.join(homedir(), ".claude", "skills");
    try {
      const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          skillMap.set(entry.name, { id: entry.name, source: "user" });
        }
      }
    } catch {
      // ~/.claude/skills may not exist
    }

    let installed: Awaited<ReturnType<typeof cliListInstalled>> = [];
    try {
      installed = await cliListInstalled(project.repoPath);
    } catch {
      // ignore: plugin CLI may not be available
    }

    for (const plugin of installed) {
      const skillsDir = path.join(plugin.installPath, "skills");
      try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !skillMap.has(entry.name)) {
            skillMap.set(entry.name, { id: entry.name, source: "plugin", pluginId: plugin.id });
          }
        }
      } catch {
        // plugin may not have a skills/ directory
      }
    }

    const commandsDir = path.join(homedir(), ".claude", "commands");
    try {
      const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const id = entry.name.slice(0, -3);
          if (!skillMap.has(id)) {
            skillMap.set(id, { id, source: "command" });
          }
        }
      }
    } catch {
      // ~/.claude/commands may not exist
    }

    for (const plugin of installed) {
      const commandsPluginDir = path.join(plugin.installPath, "commands");
      try {
        const entries = fs.readdirSync(commandsPluginDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const id = entry.name.slice(0, -3);
            if (!skillMap.has(id)) {
              skillMap.set(id, { id, source: "command", pluginId: plugin.id });
            }
          }
        }
      } catch {
        // plugin may not have a commands/ directory
      }
    }

    res.json({ skills: Array.from(skillMap.values()) });
  } catch (err) {
    console.error("[skills.installed-skills]", err);
    res.status(500).json({ error: "installed_skills_failed" });
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
