"use client";

import { useToastStore, type Toast } from "@/hooks/useToast";

const TYPE_META: Record<Toast["type"], { color: string; label: string }> = {
  success: { color: "#22c55e", label: "ok"  },
  error:   { color: "#ef4444", label: "err" },
  info:    { color: "#818cf8", label: "log" },
};

export function ToastContainer() {
  const toasts  = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => {
        const m = TYPE_META[t.type];
        return (
          <div
            key={t.id}
            style={{
              minWidth: 260, display: "flex", alignItems: "stretch",
              background: "var(--cf-surface)", border: "1px solid var(--cf-border)",
              borderRadius: 8, overflow: "hidden",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              animation: "cf-fade-up 0.18s ease-out",
              fontFamily: "var(--font-inter, Inter, sans-serif)",
            }}
          >
            <span style={{ width: 3, flexShrink: 0, background: m.color }} />
            <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 10, padding: "10px 12px" }}>
              <span style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: m.color, flexShrink: 0 }}>
                {m.label} ·
              </span>
              <span style={{ flex: 1, fontSize: 12, color: "var(--cf-text)", lineHeight: 1.4 }}>
                {t.message}
              </span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cf-muted)", fontSize: 13, padding: "1px 2px", flexShrink: 0 }}
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
