"use client";

import { useToastStore, type Toast } from "@/hooks/useToast";

const TYPE_INK: Record<Toast["type"], string> = {
  success: "var(--accent-primary)",
  error:   "var(--status-error)",
  info:    "var(--status-review)",
};

const TYPE_LABEL: Record<Toast["type"], string> = {
  success: "ok",
  error:   "err",
  info:    "log",
};

export function ToastContainer() {
  const toasts  = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => {
        const ink = TYPE_INK[t.type];
        return (
          <div
            key={t.id}
            className="animate-fade-up flex min-w-[260px] items-stretch border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl"
          >
            <span
              aria-hidden
              className="w-1 shrink-0"
              style={{ background: ink }}
            />
            <div className="flex flex-1 items-center gap-3 px-3 py-2.5">
              <span
                className="font-mono text-[10px] uppercase tracking-widest"
                style={{ color: ink }}
              >
                {TYPE_LABEL[t.type]} ·
              </span>
              <span className="flex-1 text-xs text-[var(--text-primary)]">
                {t.message}
              </span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="font-mono text-[11px] text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
