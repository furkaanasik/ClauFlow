import { Router, type Request, type Response } from "express";
import { createComment, getComments } from "../services/commentService.js";
import { getTask, getProject } from "../services/taskService.js";
import { runComment } from "../agents/commentRunner.js";

// mergeParams so we can read :id from the parent "/api/tasks/:id/comments" mount.
const router = Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    if (!taskId) return res.status(400).json({ error: "task_id_required" });
    const comments = getComments(taskId);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    if (!taskId) return res.status(400).json({ error: "task_id_required" });

    const { body } = (req.body ?? {}) as { body?: string };
    if (!body || !body.trim()) {
      return res.status(400).json({ error: "body_required" });
    }

    const task = await getTask(taskId);
    if (!task) return res.status(404).json({ error: "task_not_found" });

    const comment = createComment(task.id, body.trim());
    res.status(201).json({ comment });

    // Fire-and-forget commentRunner — only when task has a branch + project
    const project = await getProject(task.projectId);
    if (project && task.branch) {
      runComment(comment, project.repoPath).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
