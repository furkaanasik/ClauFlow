"use client";

import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  /** Auto-dismiss delay (default 3 s); long messages such as a merge conflict stay longer. */
  ms: number;
}

interface ToastState {
  toasts: Toast[];
  push: (type: ToastType, message: string, ms?: number) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (type, message, ms = 3000) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, type, message, ms }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ms);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function useToast() {
  const push = useToastStore((s) => s.push);
  return {
    success: (msg: string, ms?: number) => push("success", msg, ms),
    error:   (msg: string, ms?: number) => push("error", msg, ms),
    info:    (msg: string, ms?: number) => push("info", msg, ms),
  };
}
