"use client";

import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useScene } from "../scene";
import { useCanvasTexture } from "../textures";
import type { PaletteKey } from "../palette";
import { Ball, Block, Cyl, RBlock } from "./basics";

/* ════════════════════════════════════════════════════════════════════════
   Sparks — instanced, fully time-derived (so the reduced-motion poster frame
   shows them frozen mid-flight). One draw call.
   ════════════════════════════════════════════════════════════════════════ */

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function Sparks({
  originRef,
  activeRef,
  count = 22,
  life = 0.5,
  floorY = 0,
}: {
  originRef: MutableRefObject<THREE.Vector3>;
  /** 0..1 emission strength. */
  activeRef: MutableRefObject<number>;
  count?: number;
  life?: number;
  /** Sparks below this height are hidden (e.g. the crate lid). */
  floorY?: number;
}) {
  const { clock, palette, basic } = useScene();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = basic("stock");

  useLayoutEffect(() => {
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(i % 3 === 0 ? palette.orange : i % 3 === 1 ? palette.mustard : palette.stock);
      mesh.current.setColorAt(i, c);
    }
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [palette, count]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const t = clock.t;
    const a = activeRef.current;
    const o = originRef.current;
    for (let i = 0; i < count; i++) {
      const cyc = t / life + i / count;
      const gen = Math.floor(cyc);
      const ph = cyc - gen;
      const seed = i * 13.37 + gen * 7.1;
      const ang = hash(seed) * Math.PI * 2;
      const sp = 1.4 + hash(seed + 1) * 1.8;
      const up = 1.2 + hash(seed + 2) * 2.2;
      const age = ph * life;
      p.set(o.x + Math.cos(ang) * sp * age, o.y + up * age - 4.9 * age * age, o.z + Math.sin(ang) * sp * age);
      const size = a * (1 - ph) * (0.05 + hash(seed + 3) * 0.05);
      const visible = size > 0.004 && p.y > floorY;
      e.set(ang, ang * 2, 0);
      q.setFromEuler(e);
      s.set(visible ? size * 2.4 : 0, visible ? size : 0, visible ? size : 0);
      m.compose(p, q, s);
      mesh.current.setMatrixAt(i, m);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, count]} frustumCulled={false} />;
}

/* ════════════════════════════════════════════════════════════════════════
   Scanner — gantry over the belt with a sweeping magnifier + beam and a
   status lamp (amber while reviewing, green on pass).
   ════════════════════════════════════════════════════════════════════════ */

export interface ScannerDrive {
  /** -1..1 carriage position along the belt. */
  sweep: number;
  /** 0..1 beam strength. */
  beam: number;
  /** 1 = passed (lamp green). */
  pass: number;
}

export function Scanner({
  position,
  driveRef,
  reach = 1.9,
  height = 3.3,
  /** Height of the surface being scanned (crate lid). */
  targetY = 1.9,
  /** Half-length of the sweep along the belt. */
  travel = 0.62,
  accent = "mustard",
}: {
  position?: [number, number, number];
  driveRef: MutableRefObject<ScannerDrive>;
  /** Distance from the back column to the belt centre. */
  reach?: number;
  height?: number;
  targetY?: number;
  travel?: number;
  accent?: PaletteKey;
}) {
  const { basic, toon } = useScene();
  const carriage = useRef<THREE.Group>(null!);
  const beam = useRef<THREE.Mesh>(null!);
  const lamp = useRef<THREE.Mesh>(null!);
  const lensY = height - 0.95;
  const beamH = lensY - targetY;
  const beamGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.62, beamH, 28, 1, true);
    g.translate(0, -beamH / 2, 0);
    return g;
  }, [beamH]);
  const ringGeo = useMemo(() => new THREE.TorusGeometry(0.42, 0.075, 10, 32), []);
  const lensGeo = useMemo(() => new THREE.CircleGeometry(0.42, 32), []);

  useFrame(() => {
    const d = driveRef.current;
    carriage.current.position.x = d.sweep * travel;
    const b = THREE.MathUtils.clamp(d.beam, 0, 1);
    beam.current.visible = b > 0.02;
    beam.current.scale.set(b, 1, b);
    lamp.current.material = basic(d.pass > 0.5 ? "green" : d.beam > 0.02 ? "mustard" : "steel");
  });

  return (
    <group position={position}>
      {/* back column + boom over the belt (cantilever: nothing in front of the crate) */}
      <RBlock size={[1.2, 0.34, 1.0]} position={[0, 0.17, -reach]} color="steelDark" />
      <Block size={[0.42, height + 0.2, 0.42]} position={[0, (height + 0.2) / 2, -reach]} color={accent} />
      <Block size={[2.0, 0.34, 0.5]} position={[0, height, 0]} color={accent} />
      <Block size={[0.36, 0.34, reach + 0.2]} position={[0, height, -reach / 2 - 0.1]} color={accent} />
      {/* lamp */}
      <Cyl radius={0.2} height={0.18} position={[0, height + 0.36, -reach]} color="steelDark" />
      <mesh ref={lamp} position={[0, height + 0.56, -reach]} material={basic("steel")} scale={0.2}>
        <sphereGeometry args={[1, 16, 12]} />
      </mesh>

      {/* carriage + magnifier */}
      <group ref={carriage}>
        <RBlock size={[0.6, 0.3, 0.66]} radius={0.08} position-y={height - 0.3} color="steelDark" />
        <Cyl radius={0.05} height={0.5} position-y={height - 0.68} color="steelDark" ink={1.5} />
        <group position-y={lensY} rotation-x={-Math.PI / 2 + 0.55}>
          <mesh geometry={ringGeo} material={toon("ink2")} />
          <mesh geometry={lensGeo} material={basic("cobalt", { opacity: 0.32 })} />
        </group>
        <mesh ref={beam} geometry={beamGeo} position-y={lensY - 0.05} material={basic(accent, { opacity: 0.22 })} />
      </group>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Stamp press — C-frame behind the belt with a piston that stamps down.
   ════════════════════════════════════════════════════════════════════════ */

export function StampPress({
  position,
  pressRef,
  topY = 3.5,
  contactY = 1.88,
  reach = 1.9,
  accent = "green",
}: {
  position?: [number, number, number];
  /** 0 = up, 1 = down on the crate. */
  pressRef: MutableRefObject<number>;
  topY?: number;
  /** Height of the surface the stamp lands on. */
  contactY?: number;
  /** Distance from column to belt centre. */
  reach?: number;
  accent?: PaletteKey;
}) {
  const head = useRef<THREE.Group>(null!);
  const piston = useRef<THREE.Mesh>(null!);
  const housingBottom = topY - 0.5;
  const upY = topY - 1.0;
  const downY = contactY + 0.17;

  useFrame(() => {
    const p = THREE.MathUtils.clamp(pressRef.current, 0, 1);
    const y = THREE.MathUtils.lerp(upY, downY, p);
    head.current.position.y = y;
    const len = Math.max(0.05, housingBottom - (y + 0.14));
    piston.current.scale.y = len;
    piston.current.position.y = y + 0.14 + len / 2;
  });

  return (
    <group position={position}>
      <RBlock size={[1.3, 0.36, 1.1]} position={[0, 0.18, -reach]} color="steelDark" />
      <Block size={[0.56, topY, 0.56]} position={[0, topY / 2, -reach]} color={accent} />
      <RBlock size={[0.66, 0.52, reach + 0.7]} radius={0.1} position={[0, topY, -reach / 2 + 0.05]} color={accent} />
      <Cyl radius={0.34} height={0.36} position-y={topY - 0.38} color="steelDark" />
      <Cyl ref={piston} radius={0.13} height={1} color="steel" ink={1.75} />
      <group ref={head}>
        <RBlock size={[1.02, 0.26, 1.02]} radius={0.06} color={accent} />
        <Block size={[0.9, 0.07, 0.9]} position-y={-0.15} color="red" ink={1.5} />
      </group>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Intake hopper — square funnel on a back column; crates drop out of it.
   ════════════════════════════════════════════════════════════════════════ */

export function Hopper({
  position,
  bottomY = 3.35,
  accent = "cobalt",
}: {
  position?: [number, number, number];
  bottomY?: number;
  accent?: PaletteKey;
}) {
  const h = 0.95;
  return (
    <group position={position}>
      <Block size={[0.34, bottomY + h + 0.2, 0.34]} position={[0, (bottomY + h + 0.2) / 2, -1.45]} color="steelDark" />
      <Block size={[0.3, 0.26, 1.2]} position={[0, bottomY + h * 0.55, -0.85]} color="steelDark" />
      <Cyl radius={[1.2, 0.82]} height={h} segments={4} rotation-y={Math.PI / 4} position-y={bottomY + h / 2} color={accent} />
      <Block size={[1.86, 0.12, 1.86]} position-y={bottomY + h + 0.04} color="stock" ink={1.75} />
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Shipping bin + a wrapped crate, used at the end of the line.
   ════════════════════════════════════════════════════════════════════════ */

export function WrappedCrate({ position, scale = 1, rotationY = 0 }: { position?: [number, number, number]; scale?: number; rotationY?: number }) {
  return (
    <group position={position} scale={scale} rotation-y={rotationY}>
      <RBlock size={[1.3, 1, 1.3]} radius={0.07} color="kraft" />
      <Block size={[1.35, 1.05, 0.2]} color="green" ink={1.5} />
      <Block size={[0.2, 1.05, 1.35]} color="green" ink={1.5} />
    </group>
  );
}

export function Bin({ position, size = 2.2, wall = 0.85, accent = "green" }: { position?: [number, number, number]; size?: number; wall?: number; accent?: PaletteKey }) {
  const t = 0.14;
  const half = size / 2;
  return (
    <group position={position}>
      <Block size={[size, 0.1, size]} position-y={0.05} color="steelDark" ink={false} />
      <Block size={[size, wall, t]} position={[0, wall / 2, half - t / 2]} color="steel" />
      <Block size={[size, wall, t]} position={[0, wall / 2, -half + t / 2]} color="steel" />
      <Block size={[t, wall, size - t * 2]} position={[half - t / 2, wall / 2, 0]} color="steel" />
      <Block size={[t, wall, size - t * 2]} position={[-half + t / 2, wall / 2, 0]} color="steel" />
      <Block size={[size + 0.04, 0.14, 0.2]} position={[0, wall, half - 0.07]} color={accent} ink={1.75} />
      <WrappedCrate position={[0.35, 0.42, -0.3]} scale={0.62} rotationY={0.4} />
      <WrappedCrate position={[-0.4, 0.36, 0.35]} scale={0.56} rotationY={-0.25} />
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Terminal — a little monitor scrolling code lines while the agent works.
   ════════════════════════════════════════════════════════════════════════ */

export function Terminal({
  position,
  rotationY = 0,
  activeRef,
}: {
  position?: [number, number, number];
  rotationY?: number;
  activeRef: MutableRefObject<number>;
}) {
  const { colors, palette, clock } = useScene();
  const tex = useCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = colors.night ? palette.sunken : palette.ink;
      ctx.fillRect(0, 0, w, h);
      const hues = [palette.mustard, palette.cobalt, palette.green, palette.orange, palette.stock];
      const lh = h / 16;
      for (let i = 0; i < 32; i++) {
        const indent = (Math.floor(hash(i * 3.1) * 4) * w) / 14;
        const len = (0.2 + hash(i * 1.7) * 0.5) * w;
        ctx.fillStyle = hues[i % hues.length];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(w * 0.08 + indent, i * lh + lh * 0.3, len, lh * 0.42);
      }
      ctx.globalAlpha = 1;
    },
    256,
    384,
    `term:${palette.ink}:${palette.sunken}:${palette.mustard}:${colors.night}`,
  );
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 0.5);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  const scroll = useRef(0);

  useFrame(() => {
    scroll.current += clock.dt * 0.35 * (activeRef.current > 0.5 ? 1 : 0.08);
    tex.offset.y = scroll.current % 1;
  });

  return (
    <group position={position} rotation-y={rotationY}>
      <Block size={[0.5, 0.12, 0.4]} position-y={0.06} color="steelDark" />
      <Block size={[0.12, 0.85, 0.12]} position-y={0.5} color="steelDark" ink={1.75} />
      <group position-y={1.3} rotation-x={-0.12}>
        <RBlock size={[1.5, 1.0, 0.2]} radius={0.08} color="steel" />
        <mesh position-z={0.106} material={mat}>
          <planeGeometry args={[1.28, 0.8]} />
        </mesh>
      </group>
      <Ball radius={0.06} position={[0.6, 0.86, 0.12]} scale={0.06} color="green" ink={1.25} />
    </group>
  );
}
