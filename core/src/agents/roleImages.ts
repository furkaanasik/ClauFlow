import { attachmentsDir, listAttachments, type AttachmentRow } from "../services/attachmentService.js";
import type { PromptAttachment } from "./teamPrompts.js";

/**
 * bakim #8 (§3/28–30): what a role call needs to see a task's images.
 * Access strategy (F5/2, real CLI check passed): the files stay outside the
 * repo and the role gets `--add-dir <DATA_DIR>/attachments/<taskId>`; the
 * prompt lists the absolute paths. With no images nothing is added at all.
 */
export interface RoleImages {
  /** The task's images (task + earlier comments), minus `excludeCommentId`'s. */
  attachments: PromptAttachment[];
  /** Images of the comment being applied (comment runner only). */
  feedback: PromptAttachment[];
  /** `--add-dir` list: empty without images. */
  addDirs: string[];
}

function toPrompt(r: AttachmentRow): PromptAttachment {
  return { path: r.path, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, name: r.name };
}

export function roleImages(taskId: string, opts: { commentId?: string } = {}): RoleImages {
  const rows = listAttachments(taskId);
  const feedback = opts.commentId ? rows.filter((r) => r.commentId === opts.commentId) : [];
  const attachments = rows.filter((r) => !opts.commentId || r.commentId !== opts.commentId);
  const any = rows.length > 0 && attachments.length + feedback.length > 0;
  return {
    attachments: attachments.map(toPrompt),
    feedback: feedback.map(toPrompt),
    addDirs: any ? [attachmentsDir(taskId)] : [],
  };
}

/**
 * §3/29: a role without `Read` (a custom team role) gets it for this call when
 * the task has images, read-only access to look at them. `added` → log a line.
 */
export function toolsWithRead(tools: string[], images: RoleImages): { tools: string[]; added: boolean } {
  if (images.addDirs.length === 0 || tools.includes("Read")) return { tools, added: false };
  return { tools: [...tools, "Read"], added: true };
}

export const READ_ADDED_LOG = "[kanban] görseller için bu çağrıya Read aracı eklendi (rolün araçlarında yoktu)";
