import { existsSync, readFileSync } from "node:fs";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import {
  AttachmentError,
  addAttachment,
  deleteAttachment,
  getAttachment,
  safeName,
  toMeta,
  type AttachmentRow,
} from "../services/attachmentService.js";
import { getTask } from "../services/taskService.js";
import { broadcastTaskUpdated } from "../services/wsService.js";
import { errorMessage } from "../utils/error.js";

/**
 * bakim #8 (plan §5.6, §3/23, §3/32): image attachment endpoints.
 * - `POST /api/tasks/:id/attachments[?pending=1&name=…]` (mounted from the
 *   tasks router via `uploadAttachmentHandlers`): raw body, `Content-Type: image/*`.
 * - `GET /api/attachments/:id`, `DELETE /api/attachments/:id` (this router).
 */

const EXT_OF: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function sendAttachmentError(res: Response, err: unknown): Response {
  if (err instanceof AttachmentError) return res.status(err.httpStatus).json(err.toBody());
  return res.status(500).json({ error: errorMessage(err) });
}

/** `express.raw` only on this route (10 MB; the global JSON limit is 5 MB). Over the limit → 413 attachment_too_large. */
const rawImage = express.raw({ type: () => true, limit: "10mb" });
function rawBody(req: Request, res: Response, next: NextFunction): void {
  rawImage(req, res, (err?: unknown) => {
    if (!err) return next();
    const e = err as { type?: string; status?: number };
    if (e.type === "entity.too.large" || e.status === 413) {
      res.status(413).json({ error: "attachment_too_large", maxBytes: 10 * 1024 * 1024 });
      return;
    }
    res.status(400).json({ error: "attachment_body" });
  });
}

async function uploadAttachment(req: Request, res: Response): Promise<Response | void> {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    // §3/25: the prompt of a running (or waiting) task is already built.
    if (task.status === "doing") return res.status(409).json({ error: "task_running" });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const pending = req.query.pending === "1" || req.query.pending === "true";
    const name = typeof req.query.name === "string" ? req.query.name : null;
    const row = addAttachment(task.id, buf, { declaredMime: req.get("content-type") ?? null, name, pending });
    res.status(201).json({ attachment: { ...toMeta(row), pending: row.pending === 1 } });
    // Drafts are invisible on the task until their comment exists.
    if (!pending) {
      const fresh = await getTask(task.id);
      if (fresh) broadcastTaskUpdated(fresh);
    }
  } catch (err) {
    return sendAttachmentError(res, err);
  }
}

/** Handlers for `router.post("/:id/attachments", ...uploadAttachmentHandlers)`. */
export const uploadAttachmentHandlers = [rawBody, uploadAttachment];

/** `Content-Disposition` with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
function contentDisposition(row: AttachmentRow): string {
  const name = safeName(row.name) ?? `${row.id}.${EXT_OF[row.mime] ?? "bin"}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const router = Router();

router.get("/:id", (req: Request, res: Response) => {
  try {
    const row = getAttachment(req.params.id!);
    if (!row || !existsSync(row.path)) return res.status(404).json({ error: "attachment_not_found" });
    const body = readFileSync(row.path);
    res.setHeader("Content-Type", row.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", contentDisposition(row));
    // Ids never change and a row's file is never rewritten.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(body.length));
    res.status(200).end(body);
  } catch (err) {
    sendAttachmentError(res, err);
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const row = getAttachment(req.params.id!);
    if (!row) return res.status(404).json({ error: "attachment_not_found" });
    const task = await getTask(row.taskId);
    if (task?.status === "doing") return res.status(409).json({ error: "task_running" });
    deleteAttachment(row.id);
    res.status(204).end();
    if (task && row.pending === 0) {
      const fresh = await getTask(task.id);
      if (fresh) broadcastTaskUpdated(fresh);
    }
  } catch (err) {
    sendAttachmentError(res, err);
  }
});

export default router;
