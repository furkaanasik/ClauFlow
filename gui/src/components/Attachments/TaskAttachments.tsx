"use client";

import { useState } from "react";
import { IconLock } from "@/components/ui/icons";
import { api, attachmentUrl } from "@/lib/api";
import { errorText } from "@/lib/errorText";
import { ATTACHMENT_MAX_PER_TASK, attachmentMeta } from "@/lib/attachments";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import type { Task, TaskAttachment } from "@/types";
import { AttachmentGrid, type GridImage } from "./AttachmentGrid";
import { AttachmentInput } from "./AttachmentInput";

/** Thumbnails of uploaded attachments (lightbox caption = resolution · size). */
export function toGridImages(list: TaskAttachment[], unnamed: (n: number) => string): GridImage[] {
  return list.map((a, i) => ({
    key: a.id,
    src: attachmentUrl(a.id),
    name: a.name || unnamed(i + 1),
    meta: attachmentMeta(a),
  }));
}

/**
 * bakim #8 (plan §5.7): the drawer's "Images (N/8)" body. Every non-draft image
 * of the task (its own and its comments'), since every role reads all of them.
 * Files upload as soon as they are added; `doing` is read-only (core answers
 * `409 task_running`: the run's prompt is already built).
 */
export function TaskAttachments({ task }: { task: Task }) {
  const t = useTranslation();
  const a = t.attachments;
  const toast = useToast();
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = task.attachments ?? [];
  const running = task.status === "doing";
  const images = toGridImages(list, a.unnamed);

  const refresh = async () => {
    try {
      upsertTask(await api.getTask(task.id));
    } catch {
      // the task_updated broadcast still arrives
    }
  };

  const upload = async (files: File[]) => {
    setBusy(true);
    setError(null);
    const problems: string[] = [];
    let ok = 0;
    for (const f of files) {
      try {
        await api.uploadAttachment(task.id, f);
        ok += 1;
      } catch (err) {
        problems.push(a.fileError(f.name || a.unnamed(ok + problems.length + 1), errorText(t, err)));
      }
    }
    await refresh();
    setBusy(false);
    if (problems.length > 0) setError(problems.join(" "));
    if (ok > 0) toast.success(a.added(ok));
  };

  const remove = async (id: string) => {
    try {
      await api.deleteAttachment(id);
      await refresh();
      toast.success(a.deleted);
    } catch (err) {
      toast.error(errorText(t, err));
      throw err;
    }
  };

  if (running) {
    return (
      <div className="flex flex-col gap-2.5">
        {images.length > 0 && <AttachmentGrid images={images} label={a.label} />}
        <p className="flex items-center gap-2 rounded-[10px] border-2 border-dashed border-hair px-3 py-2 text-[12.5px] text-ink-3">
          <IconLock size={13} />
          {a.readOnly}
        </p>
      </div>
    );
  }

  return (
    <AttachmentInput
      remaining={ATTACHMENT_MAX_PER_TASK - list.length}
      onAdd={(files) => void upload(files)}
      busy={busy}
      error={error}
      showCostHint
    >
      {images.length > 0 ? (
        <AttachmentGrid images={images} label={a.label} onDelete={remove} />
      ) : (
        <p className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-3 py-2.5 text-[13px] italic text-ink-3">
          {a.empty}
        </p>
      )}
    </AttachmentInput>
  );
}
