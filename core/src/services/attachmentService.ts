import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, db } from "./taskService.js";
import type { TaskAttachmentMeta } from "../types/index.js";

/**
 * bakim #8 (plan §5.6, §3/22–33): image attachments of tasks and comments.
 * Files live outside the repo, under `<DATA_DIR>/attachments/<taskId>/<id>.<ext>`;
 * rows in `task_attachments` (cascade on task delete, files removed by the routes).
 * No resizing and no image dependency: the type is sniffed from the magic bytes
 * and the dimensions are read from the header.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 8;
/** Comment drafts (`pending = 1`) older than this are swept on every upload. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type AttachmentErrorCode =
  | "attachment_type"
  | "attachment_too_large"
  | "attachment_limit"
  | "attachment_not_pending"
  | "attachment_not_found";

const HTTP_STATUS: Record<AttachmentErrorCode, number> = {
  attachment_type: 415,
  attachment_too_large: 413,
  attachment_limit: 409,
  attachment_not_pending: 400,
  attachment_not_found: 404,
};

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;
  readonly extra: Record<string, unknown>;

  constructor(code: AttachmentErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "AttachmentError";
    this.code = code;
    this.extra = extra;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  toBody(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

// ─── Image sniffing (pure) ────────────────────────────────────────────────

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface ImageInfo {
  mime: ImageMime;
  ext: "png" | "jpg" | "webp" | "gif";
  width: number;
  height: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Buffer, bytes: number[], at = 0): boolean {
  if (buf.length < at + bytes.length) return false;
  return bytes.every((b, i) => buf[at + i] === b);
}

function ascii(buf: Buffer, at: number, len: number): string {
  return buf.length < at + len ? "" : buf.toString("latin1", at, at + len);
}

function pngInfo(buf: Buffer): ImageInfo | null {
  if (!startsWith(buf, PNG_SIG) || buf.length < 24 || ascii(buf, 12, 4) !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { mime: "image/png", ext: "png", width, height } : null;
}

function gifInfo(buf: Buffer): ImageInfo | null {
  const sig = ascii(buf, 0, 6);
  if ((sig !== "GIF87a" && sig !== "GIF89a") || buf.length < 10) return null;
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return width > 0 && height > 0 ? { mime: "image/gif", ext: "gif", width, height } : null;
}

/** Walks the JPEG markers to the first SOFn (baseline, progressive, lossless …). */
function jpegInfo(buf: Buffer): ImageInfo | null {
  if (!startsWith(buf, [0xff, 0xd8, 0xff])) return null;
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return null;
    let marker = buf[off + 1]!;
    // fill bytes
    while (marker === 0xff && off + 2 < buf.length) {
      off++;
      marker = buf[off + 1]!;
    }
    // standalone markers carry no length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any SOF
    if (off + 4 > buf.length) return null;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (off + 9 > buf.length) return null;
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return width > 0 && height > 0 ? { mime: "image/jpeg", ext: "jpg", width, height } : null;
    }
    off += 2 + len;
  }
  return null;
}

function webpInfo(buf: Buffer): ImageInfo | null {
  if (ascii(buf, 0, 4) !== "RIFF" || ascii(buf, 8, 4) !== "WEBP") return null;
  const chunk = ascii(buf, 12, 4);
  let width = 0;
  let height = 0;
  if (chunk === "VP8 ") {
    // frame tag (3) + start code 9d 01 2a + 14-bit width/height
    if (buf.length < 30 || !startsWith(buf, [0x9d, 0x01, 0x2a], 23)) return null;
    width = buf.readUInt16LE(26) & 0x3fff;
    height = buf.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L") {
    if (buf.length < 25 || buf[20] !== 0x2f) return null;
    const b0 = buf[21]!, b1 = buf[22]!, b2 = buf[23]!, b3 = buf[24]!;
    width = 1 + (b0 | ((b1 & 0x3f) << 8));
    height = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
  } else if (chunk === "VP8X") {
    if (buf.length < 30) return null;
    width = 1 + buf.readUIntLE(24, 3);
    height = 1 + buf.readUIntLE(27, 3);
  } else {
    return null;
  }
  return width > 0 && height > 0 ? { mime: "image/webp", ext: "webp", width, height } : null;
}

/** Type and dimensions from the magic bytes and header; null for anything else (SVG included). */
export function imageInfo(buf: Buffer): ImageInfo | null {
  return pngInfo(buf) ?? jpegInfo(buf) ?? gifInfo(buf) ?? webpInfo(buf);
}

/** `Content-Type` → bare lower-case mime (`image/jpg` → `image/jpeg`); undefined when absent. */
export function normalizeMime(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const m = raw.split(";")[0]!.trim().toLowerCase();
  if (!m) return undefined;
  return m === "image/jpg" || m === "image/pjpeg" ? "image/jpeg" : m;
}

/** Original file name, safe for a header and a caption: base name, no control chars, ≤ 200 chars. */
export function safeName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const base = path.basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return base ? base.slice(0, 200) : null;
}

// ─── Storage ──────────────────────────────────────────────────────────────

export interface AttachmentRow {
  id: string;
  taskId: string;
  commentId: string | null;
  path: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  name: string | null;
  pending: number;
  createdAt: string;
}

export const ATTACHMENTS_ROOT = path.join(DATA_DIR, "attachments");

/** `<DATA_DIR>/attachments/<taskId>` (absolute; also what the roles get via `--add-dir`). */
export function attachmentsDir(taskId: string): string {
  return path.join(ATTACHMENTS_ROOT, path.basename(taskId));
}

const stmtInsert = db.prepare(
  `INSERT INTO task_attachments (id, taskId, commentId, path, mime, bytes, width, height, name, pending, createdAt)
   VALUES (@id, @taskId, @commentId, @path, @mime, @bytes, @width, @height, @name, @pending, @createdAt)`,
);
const stmtCountTask = db.prepare(`SELECT COUNT(*) AS n FROM task_attachments WHERE taskId = ?`);
const stmtGet = db.prepare(`SELECT * FROM task_attachments WHERE id = ?`);
const stmtListTask = db.prepare(
  `SELECT * FROM task_attachments WHERE taskId = ? ORDER BY createdAt ASC, rowid ASC`,
);
const stmtListTaskVisible = db.prepare(
  `SELECT * FROM task_attachments WHERE taskId = ? AND pending = 0 ORDER BY createdAt ASC, rowid ASC`,
);
const stmtListComment = db.prepare(
  `SELECT * FROM task_attachments WHERE taskId = ? AND commentId = ? AND pending = 0 ORDER BY createdAt ASC, rowid ASC`,
);
const stmtDelete = db.prepare(`DELETE FROM task_attachments WHERE id = ?`);
const stmtStalePending = db.prepare(`SELECT * FROM task_attachments WHERE pending = 1 AND createdAt < ?`);
const stmtLink = db.prepare(
  `UPDATE task_attachments SET commentId = ?, pending = 0 WHERE id = ? AND taskId = ? AND pending = 1`,
);

export function toMeta(r: AttachmentRow): TaskAttachmentMeta {
  return {
    id: r.id,
    commentId: r.commentId ?? null,
    mime: r.mime,
    bytes: r.bytes,
    width: r.width ?? null,
    height: r.height ?? null,
    name: r.name ?? null,
    createdAt: r.createdAt,
  };
}

function removeFile(p: string): void {
  try {
    rmSync(p, { force: true });
  } catch {
    /* already gone */
  }
}

/** Deletes comment drafts older than PENDING_TTL_MS (rows + files). Returns how many. */
export function sweepStalePending(now = Date.now()): number {
  const cutoff = new Date(now - PENDING_TTL_MS).toISOString();
  const stale = stmtStalePending.all(cutoff) as AttachmentRow[];
  for (const r of stale) {
    stmtDelete.run(r.id);
    removeFile(r.path);
  }
  return stale.length;
}

export interface AddAttachmentOptions {
  /** The request's `Content-Type`; must match the sniffed type when given. */
  declaredMime?: string | null;
  name?: string | null;
  /** Comment draft: hidden until `linkPendingToComment`. */
  pending?: boolean;
}

/**
 * Validates and stores one image. Checks, in order: size (≤ 10 MB), sniffed
 * type (png/jpeg/webp/gif; `attachment_type` also when the declared type
 * differs), the per-task limit (8, drafts included). The caller checks that
 * the task exists and is not running.
 */
export function addAttachment(taskId: string, buf: Buffer, opts: AddAttachmentOptions = {}): AttachmentRow {
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError("attachment_too_large", { maxBytes: MAX_ATTACHMENT_BYTES });
  const info = imageInfo(buf);
  if (!info) throw new AttachmentError("attachment_type");
  const declared = normalizeMime(opts.declaredMime);
  if (declared && declared !== info.mime) throw new AttachmentError("attachment_type", { sniffed: info.mime });

  sweepStalePending();

  const id = `att_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const dir = attachmentsDir(taskId);
  const file = path.join(dir, `${id}.${info.ext}`);
  const row: AttachmentRow = {
    id,
    taskId,
    commentId: null,
    path: file,
    mime: info.mime,
    bytes: buf.length,
    width: info.width,
    height: info.height,
    name: safeName(opts.name),
    pending: opts.pending ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
  db.transaction(() => {
    const { n } = stmtCountTask.get(taskId) as { n: number };
    if (n >= MAX_ATTACHMENTS_PER_TASK) {
      throw new AttachmentError("attachment_limit", { max: MAX_ATTACHMENTS_PER_TASK });
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, buf, { mode: 0o600 });
    try {
      stmtInsert.run(row);
    } catch (err) {
      removeFile(file);
      throw err;
    }
  })();
  return row;
}

export function getAttachment(id: string): AttachmentRow | null {
  return (stmtGet.get(id) as AttachmentRow | undefined) ?? null;
}

/** Task images, oldest first. Drafts only with `includePending`. */
export function listAttachments(taskId: string, opts: { includePending?: boolean } = {}): AttachmentRow[] {
  return (opts.includePending ? stmtListTask : stmtListTaskVisible).all(taskId) as AttachmentRow[];
}

/** Attachments the user put on the task itself (not on a comment). */
export function listTaskOwnAttachments(taskId: string): AttachmentRow[] {
  return listAttachments(taskId).filter((r) => r.commentId === null);
}

/** Images linked to one comment. */
export function listCommentAttachments(taskId: string, commentId: string): AttachmentRow[] {
  return stmtListComment.all(taskId, commentId) as AttachmentRow[];
}

/** Removes the row and its file; null when the id is unknown. */
export function deleteAttachment(id: string): AttachmentRow | null {
  const row = getAttachment(id);
  if (!row) return null;
  stmtDelete.run(id);
  removeFile(row.path);
  return row;
}

/** Removes `<DATA_DIR>/attachments/<taskId>` (rows go with the task's CASCADE). */
export function removeTaskAttachmentDir(taskId: string): void {
  if (!taskId) return;
  try {
    rmSync(attachmentsDir(taskId), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Links comment drafts to the new comment (`pending` → 0) in one transaction.
 * Every id must be a draft of this task, else `attachment_not_pending` and
 * nothing changes. Run it inside the comment's own transaction when possible.
 */
export function linkPendingToComment(taskId: string, ids: string[], commentId: string): AttachmentRow[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return db.transaction(() => {
    for (const id of unique) {
      const r = getAttachment(id);
      if (!r || r.taskId !== taskId || r.pending !== 1) {
        throw new AttachmentError("attachment_not_pending", { id });
      }
    }
    for (const id of unique) stmtLink.run(commentId, id, taskId);
    return unique.map((id) => getAttachment(id)!);
  })();
}
