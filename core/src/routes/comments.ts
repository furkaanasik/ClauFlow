import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createComment, getComments } from "../services/commentService.js";
import { getTask, getProject } from "../services/taskService.js";
import { runComment } from "../agents/commentRunner.js";
import { run as gitRun } from "../services/gitService.js";
import { errorMessage } from "../utils/error.js";
import { uiLangSchema } from "../agents/uiText.js";
import { isConflictResolving } from "../agents/conflictResolver.js";

// mergeParams so we can read :id from the parent "/api/tasks/:id/comments" mount.
const router = Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    if (!taskId) return res.status(400).json({ error: "task_id_required" });
    const comments = getComments(taskId);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    if (!taskId) return res.status(400).json({ error: "task_id_required" });

    const parsed = z
      .object({ body: z.string().min(1).max(6000), uiLang: uiLangSchema.optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { body, uiLang } = parsed.data;

    const task = await getTask(taskId);
    if (!task) return res.status(404).json({ error: "task_not_found" });

    // §3/12: never on a running task (the runner would fight the executor for
    // the repo); on a done task only while its branch still exists.
    if (task.status === "doing") return res.status(409).json({ error: "task_running" });
    // zincir F4.6 (§3/42, Z38): the conflict resolver holds the branch.
    if (isConflictResolving(task)) return res.status(409).json({ error: "conflict_resolving" });
    const project = await getProject(task.projectId);
    if (task.status === "done") {
      const exists =
        !!project &&
        !!task.branch &&
        (await gitRun("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${task.branch}`], project.repoPath))
          .code === 0;
      if (!exists) return res.status(409).json({ error: "no_branch" });
    }

    const comment = createComment(task.id, body.trim());
    res.status(201).json({ comment });

    // Fire-and-forget commentRunner — only when task has a branch + project
    if (project && task.branch) {
      runComment(comment, project, { uiLang }).catch((err) =>
        console.error("[commentRunner]", err),
      );
    }
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
