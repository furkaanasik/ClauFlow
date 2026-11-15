"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { IconButton } from "./Button";
import { IconClose } from "./icons";
import { useFocusTrap, usePresence } from "./overlay";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}

const SIZE_CLS: Record<string, string> = {
  md: "max-w-2xl",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  const t = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, 140);
  useFocusTrap(panelRef, open && mounted);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="ui-scrim" data-state={state} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`ui-modal relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-panel border-2 border-line bg-panel outline-none ${SIZE_CLS[size]}`}
        style={state === "closing" ? { opacity: 0, transition: "opacity 140ms ease" } : undefined}
      >
        {title && (
          <header className="flex items-center justify-between gap-4 border-b-2 border-line px-5 py-3.5">
            <h2 id={titleId} className="t-display text-xl text-ink">
              {title}
            </h2>
            <IconButton label={t.common.close} size="sm" onClick={onClose}>
              <IconClose size={14} />
            </IconButton>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}
