"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { Ink, useScene } from "../scene";
import { roundRect, useCanvasTexture, useLabelTexture } from "../textures";
import type { PaletteKey } from "../palette";
import { Block, RBlock } from "./basics";

/* ════════════════════════════════════════════════════════════════════════
   Diorama base — a thick paper slab with an ink rule and the 2D UI's hard
   offset shadow underneath. The top is a canvas "floor print" the owner
   draws in world units.
   ════════════════════════════════════════════════════════════════════════ */

export interface FloorPainter {
  ctx: CanvasRenderingContext2D;
  /** px per world unit */
  k: number;
  /** world (x, z) → canvas px */
  at: (x: number, z: number) => [number, number];
}

export function DioramaBase({
  width,
  depth,
  center = [0, 0],
  thickness = 0.6,
  paint,
  paintKey,
}: {
  width: number;
  depth: number;
  center?: [number, number];
  thickness?: number;
  paint?: (p: FloorPainter) => void;
  /** Change to repaint (e.g. language). Palette changes repaint automatically. */
  paintKey?: string;
}) {
  const { toon, palette, colors } = useScene();
  const res = 80; // px per unit
  const W = Math.round(width * res);

  const floorTex = useCanvasTexture(
    (ctx, w, h) => {
      const k = w / width;
      ctx.fillStyle = palette.floor;
      ctx.fillRect(0, 0, w, h);
      // printed dot grid
      ctx.fillStyle = colors.night ? "rgba(244,236,218,0.10)" : "rgba(27,23,18,0.13)";
      const step = k * 0.5;
      for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      const at = (x: number, z: number): [number, number] => [
        (x - (center[0] - width / 2)) * k,
        (z - (center[1] - depth / 2)) * k,
      ];
      paint?.({ ctx, k, at });
    },
    Math.min(W, 2048),
    Math.round(Math.min(W, 2048) * (depth / width)),
    `floor:${palette.floor}:${palette.ink}:${palette.mustard}:${colors.fontSans}:${paintKey ?? ""}:${width}x${depth}`,
  );
  const floorMat = useMemo(() => new THREE.MeshToonMaterial({ map: floorTex, gradientMap: toon("panel").gradientMap }), [floorTex, toon]);

  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  shadowMat.color.set(palette.shadowInk);

  return (
    <group position={[center[0], 0, center[1]]}>
      {/* hard offset shadow, like the 3px 3px 0 plates in 2D */}
      <RoundedBox
        args={[width, 0.05, depth]}
        radius={0.024}
        smoothness={2}
        position={[0.32, -thickness + 0.02, 0.16]}
        material={shadowMat}
      />
      <RoundedBox args={[width, thickness, depth]} radius={0.28} smoothness={3} position-y={-thickness / 2} material={toon("slab")}>
        <Ink width={2.5} color="line" />
      </RoundedBox>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} material={floorMat}>
        <planeGeometry args={[width - 0.5, depth - 0.5]} />
      </mesh>
    </group>
  );
}

/** Helpers for floor painters. */
export function paintPad(
  { ctx, k, at }: FloorPainter,
  x: number,
  z: number,
  w: number,
  d: number,
  fill: string,
  stroke: string,
) {
  const [px, pz] = at(x - w / 2, z - d / 2);
  ctx.save();
  ctx.fillStyle = fill;
  roundRect(ctx, px, pz, w * k, d * k, k * 0.35);
  ctx.fill();
  ctx.setLineDash([k * 0.22, k * 0.16]);
  ctx.lineWidth = Math.max(3, k * 0.045);
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   Station sign — a printed plate on a post: "01 / TODO".
   ════════════════════════════════════════════════════════════════════════ */

export function StationSign({
  position,
  kicker,
  text,
  accent,
  on,
  height = 4.5,
}: {
  position?: [number, number, number];
  kicker: string;
  text: string;
  accent: PaletteKey;
  /** Ink colour on the accent fill (an --on-* token). */
  on: string;
  height?: number;
}) {
  const { palette, colors } = useScene();
  const tex = useLabelTexture({
    text,
    kicker,
    bg: palette[accent],
    fg: on,
    border: palette.outline,
    font: colors.fontSans,
    mono: colors.fontMono,
    weight: 800,
    size: 0.46,
    w: 512,
    h: 196,
  });
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  return (
    <group position={position}>
      <Block size={[0.16, height - 0.4, 0.16]} position-y={(height - 0.4) / 2} color="steelDark" ink={1.75} />
      <group position-y={height}>
        <RBlock size={[2.6, 1.0, 0.14]} radius={0.06} color={accent} />
        <mesh position-z={0.072} material={mat}>
          <planeGeometry args={[2.6, 1.0]} />
        </mesh>
      </group>
    </group>
  );
}
