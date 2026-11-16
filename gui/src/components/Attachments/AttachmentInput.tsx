"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { IconAlert, IconImage } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { errorText } from "@/lib/errorText";
import { ATTACHMENT_ACCEPT, dragHasFiles, imageFilesOf, validateAttachment } from "@/lib/attachments";
import { AttachmentGrid, type GridImage } from "./AttachmentGrid";

/** A picked image that is not uploaded yet (add-task modal, comment composer). */
export interface StagedImage {
  key: string;
  file: File;
  /** Object URL for the preview; revoked on remove / clear / unmount. */
  url: string;
  /** Set once uploaded (a comment draft keeps its id across a failed send). */
  uploadedId?: string;
}

/** Staged images with object-URL bookkeeping. */
export function useStagedImages() {
  const [items, setItems] = useState<StagedImage[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      for (const it of itemsRef.current) URL.revokeObjectURL(it.url);
    },
    [],
  );

  const add = useCallback((files: File[]) => {
    const next = files.map((file) => ({
      key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      url: URL.createObjectURL(file),
    }));
    setItems((prev) => [...prev, ...next]);
  }, []);

  const remove = useCallback((key: string) => {
    setItems((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.url);
      return [];
    });
  }, []);

  const markUploaded = useCallback((key: string, id: string) => {
    setItems((prev) => prev.map((p) => (p.key === key ? { ...p, uploadedId: id } : p)));
  }, []);

  const forgetUploads = useCallback(() => {
    setItems((prev) => prev.map((p) => (p.uploadedId ? { ...p, uploadedId: undefined } : p)));
  }, []);

  return { items, add, remove, clear, markUploaded, forgetUploads };
}

interface AttachmentInputProps {
  /** Slots left on the task (8 minus what it already has and what is staged). */
  remaining: number;
  /** Called with the files that passed the client checks (type, 10 MB, slots). */
  onAdd: (files: File[]) => void;
  /** The field(s) that receive paste and drop (description, comment body). */
  children?: ReactNode;
  /** Staged previews shown under the field, each removable. */
  staged?: StagedImage[];
  onRemoveStaged?: (key: string) => void;
  disabled?: boolean;
  /** Upload / send error from the parent, shown in the same banner. */
  error?: string | null;
  /** "Uploading…" next to the button. */
  busy?: boolean;
  /** Extra line under the hint (the token-cost tip). */
  showCostHint?: boolean;
  className?: string;
}

/**
 * bakim #8 (plan §5.7): paste (Ctrl+V), drag and drop, or a file picker.
 * Paste and drop are caught on the wrapper, so the wrapped textarea keeps its
 * normal text paste; only image files are taken. While files are dragged over
 * it the wrapper shows a dashed, hatched frame (DESIGN.md drop state).
 */
export function AttachmentInput({
  remaining,
  onAdd,
  children,
  staged,
  onRemoveStaged,
  disabled = false,
  error,
  busy = false,
  showCostHint = false,
  className,
}: AttachmentInputProps) {
  const t = useTranslation();
  const a = t.attachments;
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const take = (files: File[]) => {
    if (disabled || files.length === 0) return;
    const ok: File[] = [];
    const problems: string[] = [];
    let left = remaining;
    for (const f of files) {
      const code = validateAttachment(f, left);
      if (code) {
        problems.push(a.fileError(f.name || a.unnamed(problems.length + 1), errorText(t, code)));
        continue;
      }
      ok.push(f);
      left -= 1;
    }
    setClientError(problems.length > 0 ? problems.join(" ") : null);
    if (ok.length > 0) onAdd(ok);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = imageFilesOf(e.clipboardData);
    if (files.length === 0) return; // plain text paste stays untouched
    e.preventDefault();
    take(files);
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    depth.current = 0;
    setDragging(false);
    const files = imageFilesOf(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    take(files);
  };

  const shownError = [error, clientError].filter(Boolean).join(" ");
  const stagedImages: GridImage[] = (staged ?? []).map((s, i) => ({
    key: s.key,
    src: s.url,
    name: s.file.name || a.unnamed(i + 1),
  }));

  return (
    <div
      data-attachment-drop
      data-dragging={dragging || undefined}
      onPaste={onPaste}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={clsx("att-drop relative flex flex-col gap-2.5", className)}
    >
      {children}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={<IconImage size={14} />}
          loading={busy}
          disabled={disabled || remaining <= 0}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? a.uploading : a.add}
        </Button>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-3">{a.hint}</span>
        <input
          ref={inputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          hidden
          aria-label={a.fileInputLabel}
          onChange={(e) => {
            take(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {showCostHint && <p className="text-[12px] leading-snug text-ink-3">{a.costHint}</p>}

      {stagedImages.length > 0 && (
        <AttachmentGrid images={stagedImages} onRemove={disabled ? undefined : onRemoveStaged} />
      )}

      {shownError && (
        <div role="alert" className="ui-banner ui-banner--error">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          <span>{shownError}</span>
        </div>
      )}

      {dragging && (
        <div aria-hidden className="att-drop__frame ui-hatch">
          <span className="att-drop__label">
            <IconImage size={16} />
            {a.dropHere}
          </span>
        </div>
      )}
    </div>
  );
}
