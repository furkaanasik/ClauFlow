"use client";

import { useCallback, useSyncExternalStore } from "react";

import { NIGHT_CLASS, THEME_STORAGE_KEY as STORAGE_KEY, type Theme } from "@/lib/theme";

export type { Theme };

const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains(NIGHT_CLASS) ? "night" : "cream";
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // keep other tabs in sync
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    const next: Theme = e.newValue === "night" ? "night" : "cream";
    document.documentElement.classList.toggle(NIGHT_CLASS, next === "night");
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle(NIGHT_CLASS, theme === "night");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode — theme still applies for this page */
  }
  emit();
}

export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "cream");
  const setTheme = useCallback((t: Theme) => applyTheme(t), []);
  const toggleTheme = useCallback(
    () => applyTheme(readTheme() === "night" ? "cream" : "night"),
    [],
  );
  return { theme, isNight: theme === "night", setTheme, toggleTheme };
}
