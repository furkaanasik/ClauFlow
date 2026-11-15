import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { getProject } from "../services/taskService.js";
import { run } from "../services/gitService.js";
import { tryAcquireRepoLock } from "../services/repoLock.js";
import {
  listInstalled as cliListInstalled,
  uninstallPlugin as cliUninstallPlugin,
  enablePlugin as cliEnablePlugin,
  disablePlugin as cliDisablePlugin,
  cleanupOrphanCache as cliCleanupOrphanCache,
} from "../services/claudePluginCli.js";
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

export default router;
