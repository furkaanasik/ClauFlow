"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import { useSceneColors, type SceneColors } from "./colors";
import { buildPalette, type Palette, type PaletteKey } from "./palette";

/*
 * Shared scene state for every R3F scene in the app:
 *  - palette from the live CSS tokens (updates in place on theme change)
 *  - one shared material per palette colour (toon + unlit)
 *  - a scene clock that freezes on a poster frame for reduced motion
 *  - `settle()`: a few demand-mode frames after mount / theme change so
 *    one-shot work (contact-shadow bake) completes even when the loop is idle
 */

export interface SceneClock {
  /** Scene seconds. Frozen at the poster time under reduced motion. */
  t: number;
  /** Clamped frame delta (0 when frozen). */
  dt: number;
  /** Frames rendered since mount / last settle. */
  frame: number;
}

interface SceneState {
  colors: SceneColors;
  palette: Palette;
  toon: (key: PaletteKey) => THREE.MeshToonMaterial;
  basic: (key: PaletteKey, opts?: { opacity?: number }) => THREE.MeshBasicMaterial;
  clock: SceneClock;
  reducedMotion: boolean;
  settle: () => void;
}

const SceneContext = createContext<SceneState | null>(null);

export function useScene(): SceneState {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used inside <SceneCanvas>");
  return ctx;
}

/* ── toon gradient: 3 hard steps ─────────────────────────────────────────── */

let gradient: THREE.DataTexture | null = null;

/** Shared 3-step ramp (dark side 0.41, mid 0.69, lit 1.0). */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const tex = new THREE.DataTexture(new Uint8Array([105, 175, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradient = tex;
  return tex;
}

/**
 * Light rig tuned for the gradient above with NoToneMapping (`flat`): lit faces
 * land on the token hex, the camera-facing side a step down, the far side two.
 */
export function ToonLights() {
  return (
    <>
      <ambientLight intensity={1.41} />
      <directionalLight position={[-6, 10, 2]} intensity={1.73} />
    </>
  );
}

/* ── provider ────────────────────────────────────────────────────────────── */

export function SceneProvider({
  children,
  reducedMotion,
  posterTime = 0,
}: {
  children: ReactNode;
  reducedMotion: boolean;
  posterTime?: number;
}) {
  const colors = useSceneColors();
  const palette = useMemo(() => buildPalette(colors), [colors]);
  const paletteRef = useRef(palette);
  const invalidate = useThree((s) => s.invalidate);

  const toonBank = useRef(new Map<PaletteKey, THREE.MeshToonMaterial>());
  const basicBank = useRef(new Map<string, { key: PaletteKey; mat: THREE.MeshBasicMaterial }>());
  const clock = useRef<SceneClock>({ t: posterTime, dt: 0, frame: 0 }).current;
  const settleLeft = useRef(6);

  // recolour shared materials in place — no shader recompiles on theme flip
  useLayoutEffect(() => {
    paletteRef.current = palette;
    toonBank.current.forEach((m, key) => m.color.set(palette[key]));
    basicBank.current.forEach(({ key, mat }) => mat.color.set(palette[key]));
    settleLeft.current = 6;
    invalidate();
  }, [palette, invalidate]);

  useLayoutEffect(() => {
    const toon = toonBank.current;
    const basic = basicBank.current;
    return () => {
      toon.forEach((m) => m.dispose());
      basic.forEach(({ mat }) => mat.dispose());
      toon.clear();
      basic.clear();
    };
  }, []);

  useFrame((_, delta) => {
    clock.frame += 1;
    if (reducedMotion) {
      clock.t = posterTime;
      clock.dt = 0;
    } else {
      clock.dt = Math.min(delta, 1 / 20);
      clock.t += clock.dt;
    }
    if (settleLeft.current > 0) {
      settleLeft.current -= 1;
      invalidate();
    }
  }, -10);

  const value = useMemo<SceneState>(
    () => ({
      colors,
      palette,
      reducedMotion,
      clock,
      settle: () => {
        settleLeft.current = 6;
        invalidate();
      },
      toon: (key) => {
        let m = toonBank.current.get(key);
        if (!m) {
          m = new THREE.MeshToonMaterial({ color: paletteRef.current[key], gradientMap: toonGradient() });
          toonBank.current.set(key, m);
        }
        return m;
      },
      basic: (key, opts) => {
        const id = `${key}:${opts?.opacity ?? 1}`;
        let entry = basicBank.current.get(id);
        if (!entry) {
          const opacity = opts?.opacity ?? 1;
          const mat = new THREE.MeshBasicMaterial({
            color: paletteRef.current[key],
            transparent: opacity < 1,
            opacity,
            depthWrite: opacity >= 1,
            toneMapped: false,
          });
          entry = { key, mat };
          basicBank.current.set(id, entry);
        }
        return entry.mat;
      },
    }),
    [colors, palette, reducedMotion, clock, invalidate],
  );

  return <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
}

/* ── ink outline ─────────────────────────────────────────────────────────── */

/**
 * Thick ink contour (drei <Outlines>) sized in CSS pixels, so it matches the
 * 2px rules of the 2D UI at any DPR. Put it inside a closed mesh.
 */
export function Ink({ width = 2.25, color = "outline" }: { width?: number; color?: PaletteKey }) {
  const dpr = useThree((s) => s.viewport.dpr);
  // subscribe to size so Outlines re-reads the drawing-buffer size on resize
  useThree((s) => s.size);
  const { palette } = useScene();
  return <Outlines thickness={width * dpr} color={palette[color]} />;
}
