"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/*
 * Gating for 3D scenes. Free of three.js imports so DOM-side wrappers can use
 * it without pulling the renderer into the page chunk.
 */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** `prefers-reduced-motion: reduce`, live. Server snapshot: false. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => (typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_QUERY).matches),
    () => false,
  );
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/** False while the tab is hidden (`visibilitychange`). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

/** True while `ref` intersects the viewport (with a margin so the loop starts just before it scrolls in). */
export function useInView<T extends Element>(ref: RefObject<T | null>, rootMargin = "0px"): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

export interface SceneActivity {
  inView: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
  /** Visible and the tab is in front: the render loop may run. */
  active: boolean;
}

/**
 * Everything a scene needs to decide its frameloop:
 * `always` when active, `never` when off-screen or the tab is hidden,
 * `demand` (one still frame) when the user prefers reduced motion.
 */
export function useSceneActivity<T extends Element>(ref: RefObject<T | null>, rootMargin?: string): SceneActivity {
  const inView = useInView(ref, rootMargin);
  const pageVisible = usePageVisible();
  const reducedMotion = usePrefersReducedMotion();
  return { inView, pageVisible, reducedMotion, active: inView && pageVisible };
}

export type Frameloop = "always" | "demand" | "never";

export function frameloopFor({ active, reducedMotion }: Pick<SceneActivity, "active" | "reducedMotion">): Frameloop {
  if (reducedMotion) return "demand";
  return active ? "always" : "never";
}
