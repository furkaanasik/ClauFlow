"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconChevronLeft, IconChevronRight, IconImage, IconTrash } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import type { GridImage } from "./AttachmentGrid";

interface LightboxProps {
  images: GridImage[];
  /** Open image; null = closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Present only while the task is editable (not `doing`). */
  onDelete?: (key: string) => void | Promise<void>;
}

/**
 * bakim #8 (plan §5.7): Modal-based enlargement. ← / → (and the footer buttons)
 * step through the images; Esc closes (useEscapeLayer, via Modal) and the focus
 * trap returns focus to the thumbnail that opened it.
 */
export function Lightbox({ images, index, onIndexChange, onClose, onDelete }: LightboxProps) {
  const t = useTranslation();
  const a = t.attachments;
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const open = index !== null && images.length > 0;
  const i = open ? Math.min(index, images.length - 1) : 0;
  const img = images[i];
  const many = images.length > 1;

  useEffect(() => {
    if (!open || !many || confirm) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onIndexChange((i + 1) % images.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onIndexChange((i - 1 + images.length) % images.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, many, confirm, i, images.length, onIndexChange]);

  // The list shrank under us (deleted elsewhere): close when empty.
  useEffect(() => {
    if (index !== null && images.length === 0) onClose();
  }, [index, images.length, onClose]);

  const doDelete = async () => {
    if (!onDelete || !img) return;
    setDeleting(true);
    try {
      await onDelete(img.key);
      setConfirm(false);
      if (images.length <= 1) onClose();
      else if (i >= images.length - 1) onIndexChange(i - 1);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={img?.name ?? a.lightboxLabel}
        description={img?.meta}
        icon={<IconImage size={18} />}
        size="xl"
        footerStart={many ? <span className="font-mono" aria-live="polite">{a.position(i + 1, images.length)}</span> : undefined}
        footer={
          <>
            {onDelete && (
              <Button variant="danger" size="sm" icon={<IconTrash size={14} />} loading={deleting} onClick={() => setConfirm(true)}>
                {a.delete}
              </Button>
            )}
            {many && (
              <>
                <Button size="sm" icon={<IconChevronLeft size={14} />} onClick={() => onIndexChange((i - 1 + images.length) % images.length)}>
                  {a.prev}
                </Button>
                <Button size="sm" iconRight={<IconChevronRight size={14} />} onClick={() => onIndexChange((i + 1) % images.length)}>
                  {a.next}
                </Button>
              </>
            )}
          </>
        }
      >
        {img && (
          <figure className="att-lightbox">
            {/* eslint-disable-next-line @next/next/no-img-element -- attachments are served by core (or are local object URLs); next/image cannot optimise either */}
            <img src={img.src} alt={img.name} className="att-lightbox__img" />
          </figure>
        )}
      </Modal>
      <ConfirmDialog
        open={confirm}
        title={a.deleteTitle}
        description={img ? a.deleteBody(img.name) : undefined}
        confirmLabel={a.deleteConfirm}
        cancelLabel={a.cancel}
        variant="danger"
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
