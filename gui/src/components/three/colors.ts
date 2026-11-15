"use client";

import { useMemo } from "react";
import { useTheme } from "@/hooks/useTheme";

/*
 * Scene palette read from the live CSS tokens (globals.css), so 3D follows the
 * same cream / night values as the 2D UI and never hard-codes a hex.
 */

const SCENE_TOKENS = {
  paper: "--paper",
  panel: "--panel",
  sunken: "--sunken",
  ink: "--ink",
  ink2: "--ink-2",
  ink3: "--ink-3",
  line: "--line",
  hair: "--hair",
  shadowInk: "--shadow-ink",
  mustard: "--mustard",
  mustardPress: "--mustard-press",
  cobalt: "--cobalt",
  orange: "--orange",
  red: "--red",
  green: "--green",
  onMustard: "--on-mustard",
  onCobalt: "--on-cobalt",
  onOrange: "--on-orange",
  onGreen: "--on-green",
  onRed: "--on-red",
} as const;

type SceneColorKey = keyof typeof SCENE_TOKENS;

export type SceneColors = Record<SceneColorKey, string> & {
  night: boolean;
  /** Light card stock for crates/labels: panel on cream, cream ink on night. */
  stock: string;
  /** Font stacks resolved from next/font variables (for canvas labels). */
  fontSans: string;
  fontMono: string;
};

const FALLBACK: Record<SceneColorKey, string> = {
  paper: "#f4ecda",
  panel: "#fbf6ea",
  sunken: "#eadfc6",
  ink: "#1b1712",
  ink2: "#4a4237",
  ink3: "#6b6152",
  line: "#1b1712",
  hair: "#1b171226",
  shadowInk: "#1b1712",
  mustard: "#f2c33d",
  mustardPress: "#d9a923",
  cobalt: "#2d5be3",
  orange: "#ee7b2c",
  red: "#c8372d",
  green: "#3e9b5a",
  onMustard: "#1b1712",
  onCobalt: "#fbf6ea",
  onOrange: "#1b1712",
  onGreen: "#1b1712",
  onRed: "#fbf6ea",
};

/** Strip alpha from #rrggbbaa — three.Color only takes opaque colours. */
function opaque(hex: string): string {
  const h = hex.trim();
  return /^#[0-9a-f]{8}$/i.test(h) ? h.slice(0, 7) : h;
}

function readSceneColors(el?: Element | null): SceneColors {
  const root = el ?? document.documentElement;
  const cs = getComputedStyle(root);
  const out = {} as Record<SceneColorKey, string>;
  for (const [key, token] of Object.entries(SCENE_TOKENS) as [SceneColorKey, string][]) {
    const v = cs.getPropertyValue(token).trim();
    out[key] = v ? (key === "hair" ? v : opaque(v)) : FALLBACK[key];
  }
  const night = root.classList.contains("night") || !!root.closest?.(".theme-night");
  const htmlStyle = getComputedStyle(document.documentElement);
  const sans = htmlStyle.getPropertyValue("--font-jost").trim();
  const mono = htmlStyle.getPropertyValue("--font-jetbrains-mono").trim();
  return {
    ...out,
    night,
    stock: night ? out.ink : out.panel,
    fontSans: sans ? `${sans}, ui-sans-serif, system-ui, sans-serif` : "ui-sans-serif, system-ui, sans-serif",
    fontMono: mono ? `${mono}, ui-monospace, monospace` : "ui-monospace, monospace",
  };
}

/**
 * Palette for the active theme; recomputed when `useTheme` flips the
 * `html.night` class. Client-only (call from ssr:false components).
 */
export function useSceneColors(el?: Element | null): SceneColors {
  const { theme } = useTheme();
  // theme is the trigger: the class is already on <html> when it changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readSceneColors(el), [theme, el]);
}
