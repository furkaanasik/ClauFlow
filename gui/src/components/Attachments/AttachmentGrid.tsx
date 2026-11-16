"use client";

import clsx from "clsx";
import { useState } from "react";
import { IconClose } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { Lightbox } from "./Lightbox";

/** One thumbnail: an uploaded attachment (`attachmentUrl`) or a staged file (object URL). */
export interface GridImage {
  key: string;
  src: string;
  name: string;
  /** "1280×720 · 214 KB" (lightbox caption). */
  meta?: string;
}

interface AttachmentGridProps {
  images: GridImage[];
  /** Staged previews: a remove button per thumbnail (no confirm, nothing is uploaded). */
  onRemove?: (key: string) => void;
  /** Uploaded images: "Delete" in the lightbox (behind a ConfirmDialog). */
  onDelete?: (key: string) => void | Promise<void>;
  /** Accessible name of the list. */
  label?: string;
  size?: "md" | "sm";
  className?: string;
}

/**
 * bakim #8 (plan §5.7): 72 px square thumbnails, each a button that opens the
 * lightbox. The remove button is the thumbnail's sibling (no nested controls).
 */
export function AttachmentGrid({ images, onRemove, onDelete, label, size = "md", className }: AttachmentGridProps) {
  const t = useTranslation();
  const a = t.attachments;
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (images.length === 0) return null;
  const px = size === "sm" ? "h-14 w-14" : "h-[72px] w-[72px]";

  return (
    <>
      <ul aria-label={label} className={clsx("flex flex-wrap gap-2", className)}>
        {images.map((img, i) => (
          <li key={img.key} className="relative">
            <button
              type="button"
              onClick={() => setOpenAt(i)}
              aria-label={a.open(img.name)}
              title={img.name}
              className={clsx("att-thumb ui-focus", px)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- attachments are served by core (or are local object URLs); next/image cannot optimise either */}
              <img src={img.src} alt="" className="h-full w-full object-cover" draggable={false} />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(img.key)}
                aria-label={a.remove(img.name)}
                title={a.remove(img.name)}
                className="att-thumb__remove ui-focus"
              >
                <IconClose size={10} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Lightbox
        images={images}
        index={openAt}
        onIndexChange={setOpenAt}
        onClose={() => setOpenAt(null)}
        onDelete={onDelete}
      />
    </>
  );
}
