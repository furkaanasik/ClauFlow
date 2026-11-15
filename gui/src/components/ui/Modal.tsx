"use client";

import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { IconButton } from "./Button";
import { IconClose } from "./icons";
import { useEscapeLayer, useFocusTrap, usePresence } from "./overlay";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
  /** Glyph in a mustard plate before the title. */
  icon?: ReactNode;
  /** Small line under the title. */
  description?: ReactNode;
  /** Sticky action bar under the body (buttons). */
  footer?: ReactNode;
  /** Footer start slot (status text, hints). */
  footerStart?: ReactNode;
}

const SIZE_CLS: Record<string, string> = {
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  icon,
  description,
  footer,
  footerStart,
}: ModalProps) {
  const t = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, 140);
  useFocusTrap(panelRef, open && mounted);

  useEscapeLayer(open, onClose);

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
        data-state={state}
        className={`ui-modal relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-panel border-2 border-line bg-panel outline-none ${SIZE_CLS[size]}`}
      >
        {title && (
          <header className="flex items-center gap-3 border-b-2 border-line px-5 py-3.5">
            {icon && (
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border-2 border-line bg-mustard text-[var(--on-mustard)]"
                style={{ boxShadow: "2px 2px 0 var(--shadow-ink)" }}
              >
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="t-display text-xl leading-tight text-ink">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{description}</p>}
            </div>
            <IconButton label={t.common.close} size="sm" onClick={onClose}>
              <IconClose size={14} />
            </IconButton>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {(footer || footerStart) && (
          <footer className="flex items-center gap-2.5 border-t-2 border-line bg-sunken px-5 py-3">
            <div className="min-w-0 flex-1 text-[12px] text-ink-3">{footerStart}</div>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
