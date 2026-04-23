"use client";

import { useEffect } from "react";

interface ShortcutHandlers {
  onNewTask?: () => void;
  onEscape?: () => void;
  onFocusSearch?: () => void;
  onShowHelp?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (e.key === "Escape") {
        handlers.onEscape?.();
        return;
      }

      if (isInput) return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handlers.onNewTask?.();
      } else if (e.key === "/") {
        e.preventDefault();
        handlers.onFocusSearch?.();
      } else if (e.key === "?") {
        e.preventDefault();
        handlers.onShowHelp?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
