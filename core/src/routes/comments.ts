import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createComment, getComments } from "../services/commentService.js";
import { db, getTask, getProject } from "../services/taskService.js";
import { linkPendingToComment, MAX_ATTACHMENTS_PER_TASK, toMeta } from "../services/attachmentService.js";
import { sendAttachmentError } from "./attachments.js";
import { broadcastTaskUpdated } from "../services/wsService.js";
import { runComment } from "../agents/commentRunner.js";
import { run as gitRun } from "../services/gitService.js";
import { errorMessage } from "../utils/error.js";
import { LONG_TEXT_MAX_CHARS } from "../utils/http.js";
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
      .object({
        body: z.string().min(1).max(LONG_TEXT_MAX_CHARS),
        uiLang: uiLangSchema.optional(),
        // bakim #8 (§3/26): drafts uploaded with ?pending=1, linked before the runner starts.
        attachmentIds: z.array(z.string().min(1).max(64)).max(MAX_ATTACHMENTS_PER_TASK).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { body, uiLang, attachmentIds } = parsed.data;

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

    // The comment and its images are one step: a bad id creates no comment.
    let created;
    try {
      created = db.transaction(() => {
        const c = createComment(task.id, body.trim());
        const linked = attachmentIds?.length ? linkPendingToComment(task.id, attachmentIds, c.id) : [];
        return { comment: c, linked };
      })();
    } catch (err) {
      return sendAttachmentError(res, err);
    }
    const { comment, linked } = created;
    res.status(201).json({ comment, attachments: linked.map(toMeta) });
    if (linked.length > 0) {
      const fresh = await getTask(task.id);
      if (fresh) broadcastTaskUpdated(fresh);
    }

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
