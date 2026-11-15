/*
 * Layout + scroll math shared by the 3D scene and the DOM overlay. No three.js
 * here, so the hero can import it without pulling the renderer chunk.
 */

export const STATION_X = [-7.5, -2.5, 2.5, 7.5] as const;
export const STATION_KINDS = ["todo", "doing", "review", "done"] as const;
export type LineStation = (typeof STATION_KINDS)[number];

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smooth(a: number, b: number, v: number) {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
}

/** Scroll progress where the establishing shot hands over to the dolly. */
export const DOLLY_START = 0.16;
export const DOLLY_END = 0.98;

/** World x the camera looks at for a given scroll progress (close shots). */
export function focusX(progress: number) {
  const along = smooth(DOLLY_START, DOLLY_END, progress);
  return STATION_X[0] - 0.3 + (STATION_X[3] + 0.9 - (STATION_X[0] - 0.3)) * along;
}

/** Station in focus for the overlay; -1 while the establishing shot is up. */
export function focusedStation(progress: number): number {
  if (progress < DOLLY_START * 0.9) return -1;
  const x = focusX(progress);
  let best = 0;
  for (let i = 1; i < STATION_X.length; i++) {
    if (Math.abs(STATION_X[i] - x) < Math.abs(STATION_X[best] - x)) best = i;
  }
  return best;
}
