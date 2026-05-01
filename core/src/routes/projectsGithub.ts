import { Router, type Request, type Response } from "express";
import { getProject, updateProject } from "../services/taskService.js";
import { deleteGithubRepo } from "../services/gitService.js";
import { errorMessage } from "../utils/error.js";

const router = Router();

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
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
