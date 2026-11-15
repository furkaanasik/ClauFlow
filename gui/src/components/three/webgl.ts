"use client";

import { useSyncExternalStore } from "react";

/*
 * WebGL2 detection (three r163+ dropped WebGL1). No three.js import here so the
 * fallback decision happens before the renderer chunk is requested.
 *
 * `?webgl=0` in the URL forces the fallback (used by screenshot scripts).
 */

let cached: boolean | undefined;

export function hasWebGL2(): boolean {
  if (cached !== undefined) return cached;
  try {
    if (new URLSearchParams(window.location.search).get("webgl") === "0") {
      cached = false;
      return cached;
    }
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    cached = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

const noopSubscribe = () => () => {};

/** `null` during SSR/hydration, then whether WebGL2 is available. */
export function useWebGLSupport(): boolean | null {
  return useSyncExternalStore<boolean | null>(noopSubscribe, hasWebGL2, () => null);
}
