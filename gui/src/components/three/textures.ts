"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

/*
 * Canvas-drawn textures (labels, signs, floor print). Drawn with the app's own
 * Jost / JetBrains Mono via the next/font variables, so no font files or
 * troika/CDN fetches are needed. Redrawn once web fonts finish loading.
 */

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export function makeCanvasTexture(draw: Draw, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Memoised canvas texture. `key` should change whenever the drawing changes
 * (text, colours). Disposed on change/unmount.
 */
export function useCanvasTexture(draw: Draw, w: number, h: number, key: string): THREE.CanvasTexture {
  const invalidate = useThree((s) => s.invalidate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(() => makeCanvasTexture(draw, w, h), [key, w, h]);

  useEffect(() => {
    let alive = true;
    if (typeof document !== "undefined" && document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(() => {
        if (!alive) return;
        const canvas = tex.image as HTMLCanvasElement;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, w, h);
        draw(ctx, w, h);
        tex.needsUpdate = true;
        invalidate();
      });
    }
    return () => {
      alive = false;
      tex.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex]);

  return tex;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface LabelOptions {
  text: string;
  /** Small mono line above the text, e.g. "01". */
  kicker?: string;
  bg: string;
  fg: string;
  border?: string;
  font: string;
  weight?: number;
  /** Text height as a fraction of the canvas height. */
  size?: number;
  w?: number;
  h?: number;
  radius?: number;
  mono?: string;
}

/** A printed plate: rounded rect, 2px-equivalent ink rule, centred text. */
export function useLabelTexture(o: LabelOptions): THREE.CanvasTexture {
  const w = o.w ?? 512;
  const h = o.h ?? 192;
  const key = JSON.stringify(o);
  return useCanvasTexture(
    (ctx) => {
      const r = o.radius ?? h * 0.16;
      const bw = Math.max(6, h * 0.05);
      ctx.fillStyle = o.border ?? o.fg;
      roundRect(ctx, 0, 0, w, h, r);
      ctx.fill();
      ctx.fillStyle = o.bg;
      roundRect(ctx, bw, bw, w - bw * 2, h - bw * 2, Math.max(0, r - bw));
      ctx.fill();
      ctx.fillStyle = o.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const size = Math.round(h * (o.size ?? 0.5));
      if (o.kicker) {
        ctx.font = `800 ${Math.round(h * 0.2)}px ${o.mono ?? o.font}`;
        ctx.globalAlpha = 0.8;
        ctx.fillText(o.kicker, w / 2, h * 0.26);
        ctx.globalAlpha = 1;
        ctx.font = `${o.weight ?? 800} ${size}px ${o.font}`;
        ctx.fillText(o.text, w / 2, h * 0.63);
      } else {
        ctx.font = `${o.weight ?? 800} ${size}px ${o.font}`;
        ctx.fillText(o.text, w / 2, h * 0.54);
      }
    },
    w,
    h,
    key,
  );
}

/** Repeating diagonal belt treads, scrolled via `offset.x`. */
export function useStripeTexture(a: string, b: string, repeat: number): THREE.CanvasTexture {
  const tex = useCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, w * 0.18, h);
    },
    64,
    16,
    `stripe:${a}:${b}`,
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, 1);
  return tex;
}
