"use client";

import { useToastStore, type Toast } from "@/hooks/useToast";

const TYPE_STYLES: Record<Toast["type"], string> = {
  success: "border-emerald-700/60 bg-emerald-950/80 text-emerald-200",
  error:   "border-red-700/60    bg-red-950/80    text-red-200",
  info:    "border-blue-700/60   bg-blue-950/80   text-blue-200",
};

const TYPE_DOT: Record<Toast["type"], string> = {
  success: "bg-emerald-400",
  error:   "bg-red-400",
  info:    "bg-blue-400",
};

export function ToastContainer() {
  const toasts  = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-fade-up flex items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-2xl backdrop-blur-sm ${TYPE_STYLES[t.type]}`}
          onMouseEnter={() => {/* hover'da durdurmak icin gelecekte eklenebilir */}}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[t.type]}`} />
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="ml-2 shrink-0 opacity-50 hover:opacity-100 transition"
            aria-label="Kapat"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
