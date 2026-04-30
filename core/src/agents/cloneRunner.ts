import fs from "node:fs";
import path from "node:path";
import { runWithProgress, run } from "../services/gitService.js";
import { createProject } from "../services/taskService.js";
import { broadcastCloneProgress } from "../services/wsService.js";

export interface CloneRepoInput {
  repoUrl: string;
  targetPath: string;
  name: string;
}

export async function runCloneRepo(input: CloneRepoInput): Promise<void> {
  const { repoUrl, targetPath, name } = input;
  const targetExistedBefore = fs.existsSync(targetPath);

  const cleanupPartial = () => {
    if (targetExistedBefore) return;
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (err) {
      console.error("[cloneRunner] failed to clean partial clone:", err);
    }
  };

  try {
    broadcastCloneProgress(targetPath, "cloning", "Starting git clone...");

    const parent = path.dirname(targetPath);
    fs.mkdirSync(parent, { recursive: true });

    const result = await runWithProgress(
      "git",
      ["clone", "--progress", repoUrl, targetPath],
      parent,
      (line) => {
        broadcastCloneProgress(targetPath, "cloning", line);
      },
    );

    if (result.code !== 0) {
      cleanupPartial();
      const errMsg = result.stderr.trim() || result.stdout.trim() || `git clone exited with code ${result.code}`;
      broadcastCloneProgress(targetPath, "error", errMsg);
      return;
    }

    let defaultBranch = "main";
    const headRef = await run("git", ["symbolic-ref", "--short", "HEAD"], targetPath);
    if (headRef.code === 0) {
      const branch = headRef.stdout.trim();
      if (branch.length > 0) defaultBranch = branch;
    }

    const project = await createProject({
      name,
      repoPath: targetPath,
      remote: repoUrl,
      defaultBranch,
    });

    broadcastCloneProgress(targetPath, "done", "Clone complete", project);
  } catch (err) {
    cleanupPartial();
    const message = err instanceof Error ? err.message : String(err);
    broadcastCloneProgress(targetPath, "error", message);
  }
}
