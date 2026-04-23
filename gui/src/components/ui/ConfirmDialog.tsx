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
  confirmLabel = "Onayla",
  cancelLabel = "İptal",
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

  const confirmCls = {
    danger:  "bg-red-600 hover:bg-red-500 text-white",
    warning: "bg-yellow-600 hover:bg-yellow-500 text-white",
    default: "bg-blue-600 hover:bg-blue-500 text-white",
  }[variant];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative w-full max-w-sm animate-fade-up rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        {/* Icon */}
        {variant === "danger" && (
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-950/60 text-red-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </div>
        )}
        {variant === "warning" && (
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-yellow-950/60 text-yellow-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        )}

        <h3 className="mb-1 text-sm font-semibold text-zinc-100">{title}</h3>
        {description && (
          <p className="mb-5 text-xs leading-relaxed text-zinc-500">{description}</p>
        )}
        {!description && <div className="mb-5" />}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={clsx("rounded-lg px-4 py-2 text-sm font-medium transition", confirmCls)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
