"use client";

import { useEffect } from "react";
import clsx from "clsx";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const variantInk = {
    danger:  "var(--status-error)",
    warning: "var(--status-warning)",
    default: "var(--accent-primary)",
  }[variant];

  const confirmCls = clsx(
    "border px-4 py-2 text-[12px] font-medium transition",
    variant === "danger"  && "border-[var(--status-error)] bg-[var(--status-error)] text-[var(--bg-base)] hover:bg-[var(--bg-base)] hover:text-[var(--status-error)]",
    variant === "warning" && "border-[var(--status-warning)] bg-[var(--status-warning)] text-[var(--bg-base)] hover:bg-[var(--bg-base)] hover:text-[var(--status-warning)]",
    variant === "default" && "btn-ink",
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md animate-fade-up border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl">
        <div
          aria-hidden
          className="h-1 w-full"
          style={{ background: variantInk }}
        />
        <div className="px-5 py-5">
          <h3 className="t-display text-2xl leading-tight text-[var(--text-primary)]">
            {title}
          </h3>
          {description && (
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              {description}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost px-4 py-2 text-[12px] font-medium"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={confirmCls}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
