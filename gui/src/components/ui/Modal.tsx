"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}

const SIZE_W: Record<string, number> = {
  md: 400,
  lg: 480,
  xl: 640,
};

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%", maxWidth: SIZE_W[size], maxHeight: "85vh",
          background: "var(--cf-surface)", border: "1px solid var(--cf-border)",
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          animation: "cf-fade-up 0.18s ease-out",
          fontFamily: "var(--font-inter, Inter, sans-serif)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px", borderBottom: "1px solid var(--cf-border)",
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--cf-text)", margin: 0 }}>
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--cf-muted)", fontSize: 16, padding: "2px 4px",
                display: "flex", alignItems: "center",
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div style={{ maxHeight: "70vh", overflowY: "auto", padding: 20 }} className="cf-scroll">
          {children}
        </div>
      </div>
    </div>
  );
}
