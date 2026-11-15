"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { IconAlert, IconInfo } from "./icons";
import { useEscapeLayer, useFocusTrap, usePresence } from "./overlay";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

const BADGE = {
  danger: { bg: "var(--red)", fg: "var(--on-red)" },
  warning: { bg: "var(--orange)", fg: "var(--on-orange)" },
  default: { bg: "var(--cobalt)", fg: "var(--on-cobalt)" },
} as const;

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, 140);
  useFocusTrap(panelRef, open && mounted);
  useEscapeLayer(open, onCancel);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // a focused button handles Enter itself — avoid a double confirm
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!mounted) return null;

  const badge = BADGE[variant];

  /* Portalled to <body>: a dialog opened from inside a transformed parent
     (drawer, tab panel, React Flow node) would otherwise be trapped by it. */
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="ui-scrim" data-state={state} onClick={open ? onCancel : undefined} aria-hidden="true" />

      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-state={state}
        className="ui-modal relative w-full max-w-md rounded-panel border-2 border-line bg-panel outline-none"
      >
        <div className="flex gap-4 px-5 pb-5 pt-5">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border-2 border-line"
            style={{ background: badge.bg, color: badge.fg, boxShadow: "2px 2px 0 var(--shadow-ink)" }}
          >
            {variant === "default" ? <IconInfo size={18} /> : <IconAlert size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="t-display text-[22px] leading-tight text-ink">
              {title}
            </h3>
            {description && (
              <p id={descId} className="mt-2 text-sm leading-relaxed text-ink-2">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t-2 border-line bg-sunken px-5 py-3.5" style={{ borderRadius: "0 0 12px 12px" }}>
          <Button variant="secondary" onClick={open ? onCancel : undefined}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={open ? onConfirm : undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
