import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createComment, getComments } from "../services/commentService.js";
import { getTask, getProject } from "../services/taskService.js";
import { runComment } from "../agents/commentRunner.js";
import { errorMessage } from "../utils/error.js";

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
      .object({ body: z.string().min(1).max(6000) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { body } = parsed.data;

    const task = await getTask(taskId);
    if (!task) return res.status(404).json({ error: "task_not_found" });

    const comment = createComment(task.id, body.trim());
    res.status(201).json({ comment });

    // Fire-and-forget commentRunner — only when task has a branch + project
    const project = await getProject(task.projectId);
    if (project && task.branch) {
      runComment(comment, project.repoPath).catch((err) =>
        console.error("[commentRunner]", err),
      );
    }
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
