"use client";

import { useToastStore, type Toast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import { IconAlert, IconCheck, IconClose, IconInfo } from "./icons";

const TYPE_STYLE: Record<Toast["type"], { bg: string; fg: string; Icon: typeof IconCheck }> = {
  success: { bg: "var(--green)", fg: "var(--on-green)", Icon: IconCheck },
  error: { bg: "var(--red)", fg: "var(--on-red)", Icon: IconAlert },
  info: { bg: "var(--cobalt)", fg: "var(--on-cobalt)", Icon: IconInfo },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const t = useTranslation();

  if (toasts.length === 0) return null;

  const label: Record<Toast["type"], string> = {
    success: t.common.toastSuccess,
    error: t.common.toastError,
    info: t.common.toastInfo,
  };

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3" role="region" aria-live="polite">
      {toasts.map((toast) => {
        const st = TYPE_STYLE[toast.type];
        return (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className="ui-modal flex min-w-[280px] max-w-[420px] items-center gap-3 rounded-[12px] border-2 border-line bg-panel py-2.5 pl-2.5 pr-2"
            style={{ boxShadow: "var(--shadow)" }}
          >
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border-2 border-line"
              style={{ background: st.bg, color: st.fg }}
            >
              <st.Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                {label[toast.type]}
              </div>
              <div className="text-[13px] font-medium leading-snug text-ink">{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="ui-focus grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ink-3 transition hover:bg-hair hover:text-ink"
              aria-label={t.common.dismiss}
            >
              <IconClose size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
