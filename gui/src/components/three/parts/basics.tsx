"use client";

import { forwardRef, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { Ink, useScene } from "../scene";
import type { PaletteKey } from "../palette";

/*
 * Toon-shaded primitives with an optional ink contour. Every coloured surface
 * in the factory is one of these, so a theme flip only recolours materials.
 */

type MeshProps = Omit<ThreeElements["mesh"], "args" | "material" | "children">;

interface BaseProps extends MeshProps {
  color: PaletteKey;
  /** Outline width in CSS px; `false` for none. */
  ink?: number | false;
  children?: ReactNode;
}

const boxGeoCache = new Map<string, THREE.BoxGeometry>();
function boxGeo(w: number, h: number, d: number) {
  const k = `${w}|${h}|${d}`;
  let g = boxGeoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxGeoCache.set(k, g);
  }
  return g;
}

/** Sharp box. */
export const Block = forwardRef<THREE.Mesh, BaseProps & { size: [number, number, number] }>(function Block(
  { size, color, ink = 2.25, children, ...rest },
  ref,
) {
  const { toon } = useScene();
  return (
    <mesh ref={ref} geometry={boxGeo(size[0], size[1], size[2])} material={toon(color)} {...rest}>
      {ink !== false && <Ink width={ink} />}
      {children}
    </mesh>
  );
});

/** Chunky rounded box — crates, machine housings. */
export const RBlock = forwardRef<THREE.Mesh, BaseProps & { size: [number, number, number]; radius?: number }>(
  function RBlock({ size, radius = 0.08, color, ink = 2.25, children, ...rest }, ref) {
    const { toon } = useScene();
    return (
      <RoundedBox ref={ref} args={size} radius={radius} smoothness={2} material={toon(color)} {...rest}>
        {ink !== false && <Ink width={ink} />}
        {children}
      </RoundedBox>
    );
  },
);

const cylGeoCache = new Map<string, THREE.CylinderGeometry>();
function cylGeo(rt: number, rb: number, h: number, seg: number) {
  const k = `${rt}|${rb}|${h}|${seg}`;
  let g = cylGeoCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    cylGeoCache.set(k, g);
  }
  return g;
}

/** Cylinder (y-up). `radius` or `[top, bottom]`. */
export const Cyl = forwardRef<
  THREE.Mesh,
  BaseProps & { radius: number | [number, number]; height: number; segments?: number }
>(function Cyl({ radius, height, segments = 20, color, ink = 2.25, children, ...rest }, ref) {
  const { toon } = useScene();
  const [rt, rb] = Array.isArray(radius) ? radius : [radius, radius];
  return (
    <mesh ref={ref} geometry={cylGeo(rt, rb, height, segments)} material={toon(color)} {...rest}>
      {ink !== false && <Ink width={ink} />}
      {children}
    </mesh>
  );
});

const sphereGeo = /* @__PURE__ */ (() => {
  let g: THREE.SphereGeometry | null = null;
  return () => (g ??= new THREE.SphereGeometry(1, 18, 12));
})();

export const Ball = forwardRef<THREE.Mesh, BaseProps & { radius: number }>(function Ball(
  { radius, color, ink = 2.25, children, ...rest },
  ref,
) {
  const { toon } = useScene();
  return (
    <mesh ref={ref} geometry={sphereGeo()} material={toon(color)} scale={radius} {...rest}>
      {ink !== false && <Ink width={ink} />}
      {children}
    </mesh>
  );
});

/* ── soft blob shadow (for movers that skip the contact-shadow bake) ─────── */

let blobTex: THREE.CanvasTexture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.9)");
  g.addColorStop(0.55, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const planeGeo = /* @__PURE__ */ (() => {
  let g: THREE.PlaneGeometry | null = null;
  return () => (g ??= new THREE.PlaneGeometry(1, 1));
})();

export function sharedPlane() {
  return planeGeo();
}

/** Flat soft shadow lying on a surface. */
export const Blob = forwardRef<THREE.Mesh, MeshProps & { size: [number, number]; opacity?: number }>(function Blob(
  { size, opacity = 0.32, ...rest },
  ref,
) {
  const { palette, colors } = useScene();
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [opacity],
  );
  mat.color.set(colors.night ? "#000000" : palette.ink);
  return (
    <mesh
      ref={ref}
      geometry={planeGeo()}
      material={mat}
      rotation-x={-Math.PI / 2}
      scale={[size[0], size[1], 1]}
      renderOrder={1}
      {...rest}
    />
  );
});
