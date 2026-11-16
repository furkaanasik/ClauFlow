import type { TaskAttachment } from "@/types";

/**
 * bakim #8: client-side mirror of core's attachment limits (plan §1 #8, §3/25).
 * Core sniffs the real type from the bytes; this check only saves a round trip
 * and uses the same error codes, so `errorText` translates both alike.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_TASK = 8;
export const ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const ATTACHMENT_ACCEPT = ATTACHMENT_MIMES.join(",");

export type AttachmentClientError = "attachment_type" | "attachment_too_large" | "attachment_limit";

export function isAcceptedImage(file: Blob): boolean {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  return (ATTACHMENT_MIMES as readonly string[]).includes(type);
}

/** The first rule a file breaks, or null. `remaining` = slots left on the task. */
export function validateAttachment(file: Blob, remaining: number): AttachmentClientError | null {
  if (!isAcceptedImage(file)) return "attachment_type";
  if (file.size > ATTACHMENT_MAX_BYTES) return "attachment_too_large";
  if (remaining <= 0) return "attachment_limit";
  return null;
}

/** Image files of a paste or drop (text and other items are ignored). */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f && f.type.startsWith("image/")) out.push(f);
    }
    if (out.length > 0) return out;
  }
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) out.push(f);
  return out;
}

/** True when a drag carries files (shows the drop frame; text drags are left alone). */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types ?? []).includes("Files");
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "1280×720 · 214 KB" (dimensions only when known). */
export function attachmentMeta(a: Pick<TaskAttachment, "width" | "height" | "bytes">): string {
  const size = formatBytes(a.bytes);
  return a.width && a.height ? `${a.width}×${a.height} · ${size}` : size;
}

/** Task-level images (no comment), in upload order. */
export function taskOwnAttachments(list: TaskAttachment[] | undefined): TaskAttachment[] {
  return (list ?? []).filter((a) => a.commentId === null);
}
