import * as THREE from "three";
import type { SceneColors } from "./colors";

/*
 * Scene palette = CSS tokens + a few derived stocks (cardboard, steel, belt
 * rubber). Derived values are mixes of tokens so both themes stay in key.
 */

const mix = (a: string, b: string, t: number) =>
  "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

export function buildPalette(c: SceneColors) {
  const outline = c.night ? c.sunken : c.line;
  return {
    paper: c.paper,
    panel: c.panel,
    sunken: c.sunken,
    ink: c.ink,
    ink2: c.ink2,
    ink3: c.ink3,
    line: c.line,
    shadowInk: c.shadowInk,
    mustard: c.mustard,
    mustardPress: c.mustardPress,
    cobalt: c.cobalt,
    orange: c.orange,
    red: c.red,
    green: c.green,
    stock: c.stock,
    /** Dark print on light stock (labels) — stays dark in both themes. */
    print: c.night ? c.paper : c.ink,
    /** Object outlines: ink on cream; near-black on night (cream rules would glow on lit forms). */
    outline,
    kraft: mix(c.stock, c.mustard, 0.42),
    kraftDark: mix(c.stock, c.mustardPress, 0.62),
    steel: c.night ? mix(c.ink3, c.stock, 0.35) : mix(c.ink3, c.stock, 0.55),
    steelDark: c.night ? mix(c.ink3, c.panel, 0.2) : mix(c.ink2, c.ink3, 0.5),
    belt: c.night ? mix(c.panel, c.ink3, 0.3) : c.ink2,
    slab: c.night ? mix(c.panel, c.ink3, 0.12) : c.panel,
    floor: c.night ? c.panel : mix(c.panel, c.sunken, 0.35),
    tape: c.mustard,
    rubber: c.night ? c.sunken : c.ink,
  };
}

export type Palette = ReturnType<typeof buildPalette>;
export type PaletteKey = keyof Palette;

/** A token-coloured accent per board station. */
export const STATION_ACCENT = {
  todo: "cobalt",
  doing: "orange",
  review: "mustard",
  done: "green",
} as const satisfies Record<string, PaletteKey>;

export type StationKind = keyof typeof STATION_ACCENT;

export function mixHex(a: string, b: string, t: number) {
  return mix(a, b, t);
}
