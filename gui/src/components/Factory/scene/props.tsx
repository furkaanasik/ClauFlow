"use client";

import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  Ball,
  Block,
  Cyl,
  RBlock,
  Ink,
  roundRect,
  useCanvasTexture,
  useScene,
  type PaletteKey,
} from "@/components/three";

/*
 * Board-factory props that the landing kit doesn't have: a fit-to-width
 * station sign, the CI test gate, the andon light tower, the error beacon,
 * budget smoke, the "+N" overflow pile and an instanced blob-shadow field.
 */

/* ── text helpers ─────────────────────────────────────────────────────────── */

/** Draw `text` centred at (x, y), shrinking the font until it fits `maxW`. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  weight: number,
  family: string,
) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  ctx.fillText(text, x, y);
}

/* ════════════════════════════════════════════════════════════════════════
   Station sign — plate on a post: name, and a mono kicker with the count.
   ════════════════════════════════════════════════════════════════════════ */

export function FactorySign({
  position,
  kicker,
  text,
  accent,
  on,
  width = 2.5,
  height = 3.7,
}: {
  position: [number, number, number];
  kicker: string;
  text: string;
  accent: PaletteKey;
  on: string;
  width?: number;
  height?: number;
}) {
  const { palette, colors } = useScene();
  const W = 512;
  const H = Math.round((W / width) * 0.95);
  const tex = useCanvasTexture(
    (ctx, w, h) => {
      const bw = Math.max(6, h * 0.05);
      const r = h * 0.16;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = palette.outline;
      roundRect(ctx, 0, 0, w, h, r);
      ctx.fill();
      ctx.fillStyle = palette[accent];
      roundRect(ctx, bw, bw, w - bw * 2, h - bw * 2, r - bw);
      ctx.fill();
      ctx.fillStyle = on;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.82;
      fitText(ctx, kicker, w / 2, h * 0.28, w * 0.8, Math.round(h * 0.2), 800, colors.fontMono);
      ctx.globalAlpha = 1;
      fitText(ctx, text, w / 2, h * 0.64, w * 0.84, Math.round(h * 0.42), 800, colors.fontSans);
    },
    W,
    H,
    `fsign:${kicker}:${text}:${palette[accent]}:${on}:${palette.outline}:${colors.fontSans}`,
  );
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  const plateH = width * 0.38;
  return (
    <group position={position}>
      <Block size={[0.14, height - 0.3, 0.14]} position-y={(height - 0.3) / 2} color="steelDark" ink={1.75} />
      <group position-y={height}>
        <RBlock size={[width, plateH, 0.12]} radius={0.05} color={accent} />
        <mesh position-z={0.062} material={mat}>
          <planeGeometry args={[width, plateH]} />
        </mesh>
      </group>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Andon tower — red / mustard / green lamps on a post. Green while an agent
   runs, mustard for queued work, red flashing (+ a turning beam) on error.
   ════════════════════════════════════════════════════════════════════════ */

export interface AndonState {
  run: number;
  queue: number;
  alarm: number;
}

export function Andon({ position, stateRef }: { position: [number, number, number]; stateRef: MutableRefObject<AndonState> }) {
  const { basic, clock } = useScene();
  const red = useRef<THREE.Mesh>(null!);
  const amber = useRef<THREE.Mesh>(null!);
  const green = useRef<THREE.Mesh>(null!);
  const beam = useRef<THREE.Group>(null!);
  const lampGeo = useMemo(() => new THREE.CylinderGeometry(0.2, 0.2, 0.3, 16), []);

  useFrame(() => {
    const s = stateRef.current;
    const t = clock.t;
    const flash = s.alarm > 0.5 && Math.sin(t * 10) > -0.2;
    red.current.material = basic(flash ? "red" : "steel");
    amber.current.material = basic(s.queue > 0.5 ? "mustard" : "steel");
    green.current.material = basic(s.run > 0.5 ? "green" : "steel");
    beam.current.visible = s.alarm > 0.5;
    beam.current.rotation.y = t * 5;
  });

  const top = 2.6;
  return (
    <group position={position}>
      <Cyl radius={[0.3, 0.36]} height={0.16} position-y={0.08} color="steelDark" />
      <Cyl radius={0.06} height={top - 0.5} position-y={(top - 0.5) / 2 + 0.1} color="steelDark" ink={1.5} />
      <group position-y={top - 0.5}>
        <mesh ref={green} geometry={lampGeo} position-y={0} material={basic("steel")}>
          <Ink width={1.75} />
        </mesh>
        <mesh ref={amber} geometry={lampGeo} position-y={0.32} material={basic("steel")}>
          <Ink width={1.75} />
        </mesh>
        <mesh ref={red} geometry={lampGeo} position-y={0.64} material={basic("steel")}>
          <Ink width={1.75} />
        </mesh>
        <Cyl radius={0.22} height={0.08} position-y={0.84} color="steelDark" ink={1.5} />
        <group ref={beam} position-y={0.64} visible={false}>
          <mesh material={basic("red", { opacity: 0.28 })} position-x={0.7} rotation-z={Math.PI / 2}>
            <coneGeometry args={[0.32, 1.2, 14, 1, true]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Error beacon — sits on a crate lid: red dome, turning light fan, and a
   pulsing ring on the floor.
   ════════════════════════════════════════════════════════════════════════ */

export function Beacon({ y, ringY }: { y: number; ringY: number }) {
  const { basic, clock } = useScene();
  const fan = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.62, 0.74, 32), []);
  useFrame(() => {
    const t = clock.t;
    fan.current.rotation.y = t * 6;
    const p = (t * 1.3) % 1;
    ring.current.scale.setScalar(1 + p * 0.6);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - p);
  });
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    [],
  );
  const { palette } = useScene();
  ringMat.color.set(palette.red);
  return (
    <>
      <group position-y={y}>
        <Cyl radius={0.17} height={0.09} position-y={0.045} color="steelDark" ink={1.5} />
        <mesh position-y={0.17} material={basic("red")} scale={[0.14, 0.16, 0.14]}>
          <sphereGeometry args={[1, 14, 10]} />
          <Ink width={1.5} />
        </mesh>
        <group ref={fan} position-y={0.17}>
          {[0, Math.PI].map((r) => (
            <mesh key={r} rotation-y={r} position-x={Math.cos(r) * 0.5} material={basic("red", { opacity: 0.3 })}>
              <boxGeometry args={[0.8, 0.12, 0.02]} />
            </mesh>
          ))}
        </group>
      </group>
      <mesh ref={ring} geometry={ringGeo} material={ringMat} rotation-x={-Math.PI / 2} position-y={ringY} renderOrder={2} />
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Budget smoke — inked puffs that rise, swell and shrink away. Instanced:
   one draw (+ outline) per smoking crate.
   ════════════════════════════════════════════════════════════════════════ */

const PUFFS = 6;
export function Smoke({ y }: { y: number }) {
  const { toon, clock } = useScene();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = clock.t;
    for (let i = 0; i < PUFFS; i++) {
      const ph = (t * 0.42 + i / PUFFS) % 1;
      const k = Math.sin(Math.PI * Math.min(1, ph * 1.15));
      p.set(Math.sin(i * 2.1 + t * 0.9) * 0.22 + ph * 0.45, y + 0.2 + ph * 2.3, Math.cos(i * 1.7) * 0.18);
      const r = 0.14 + k * 0.3;
      s.set(r, r, r);
      m.compose(p, q, s);
      mesh.current.setMatrixAt(i, m);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[geo, toon("steel"), PUFFS]} frustumCulled={false}>
      <Ink width={1.75} />
    </instancedMesh>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Overflow pile — a heap of plain crates with a "+N" plate.
   ════════════════════════════════════════════════════════════════════════ */

export function Pile({
  position,
  count,
  hovered,
  onOver,
  onMove,
  onOut,
  onPick,
}: {
  position: [number, number, number];
  count: number;
  hovered: boolean;
  onOver: (e: ThreeEvent<PointerEvent>) => void;
  onMove: (e: ThreeEvent<PointerEvent>) => void;
  onOut: () => void;
  onPick: () => void;
}) {
  const { palette, colors } = useScene();
  const tex = useCanvasTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = palette.outline;
      roundRect(ctx, 0, 0, w, h, h * 0.3);
      ctx.fill();
      ctx.fillStyle = palette.mustard;
      roundRect(ctx, 8, 8, w - 16, h - 16, h * 0.3 - 8);
      ctx.fill();
      ctx.fillStyle = colors.onMustard;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fitText(ctx, `+${count}`, w / 2, h * 0.54, w * 0.8, Math.round(h * 0.6), 800, colors.fontMono);
    },
    256,
    128,
    `pile:${count}:${palette.mustard}:${palette.outline}:${colors.fontMono}`,
  );
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);
  const s = 0.42;
  return (
    <group
      position={[position[0], 0, position[2]]}
      onPointerOver={onOver}
      onPointerMove={onMove}
      onPointerOut={onOut}
      onClick={(e) => {
        if (e.delta > 5) return;
        e.stopPropagation();
        onPick();
      }}
    >
      <group position-y={hovered ? 0.06 : 0}>
        <RBlock size={[s * 1.3, s, s * 1.3]} position={[-0.2, s / 2, -0.15]} rotation-y={0.3} radius={0.04} color="kraft" ink={1.75} />
        <RBlock size={[s * 1.3, s, s * 1.3]} position={[0.22, s / 2, 0.12]} rotation-y={-0.2} radius={0.04} color="kraft" ink={1.75} />
        <RBlock size={[s * 1.3, s, s * 1.3]} position={[0, s * 1.5 + 0.01, 0]} rotation-y={0.1} radius={0.04} color="kraftDark" ink={1.75} />
        <mesh position={[0, s * 2 + 0.42, 0]} material={mat}>
          <planeGeometry args={[0.78, 0.39]} />
        </mesh>
        <Ball radius={0.04} position={[0, s * 2 + 0.16, 0]} scale={[0.03, 0.2, 0.03]} color="steelDark" ink={false} />
      </group>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Blob field — every crate's soft floor shadow in one instanced draw call.
   Crates write their slot each frame through the returned setter.
   ════════════════════════════════════════════════════════════════════════ */

let blobTex: THREE.CanvasTexture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.55, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export interface BlobField {
  mesh: MutableRefObject<THREE.InstancedMesh | null>;
  set: (i: number, x: number, y: number, z: number, size: number) => void;
}

export function useBlobField(capacity: number): BlobField {
  const mesh = useRef<THREE.InstancedMesh | null>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  return useMemo<BlobField>(
    () => ({
      mesh,
      set: (i, x, y, z, size) => {
        const im = mesh.current;
        if (!im || i < 0 || i >= capacity) return;
        m.makeRotationX(-Math.PI / 2);
        m.scale(new THREE.Vector3(size, size, 1));
        m.setPosition(x, y, z);
        im.setMatrixAt(i, m);
        im.instanceMatrix.needsUpdate = true;
      },
    }),
    [capacity, m],
  );
}

export function BlobFieldMesh({ field, capacity }: { field: BlobField; capacity: number }) {
  const { palette, colors } = useScene();
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [],
  );
  mat.color.set(colors.night ? "#000000" : palette.ink);
  mat.opacity = colors.night ? 0.5 : 0.28;
  useLayoutEffect(() => {
    const im = field.mesh.current;
    if (!im) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) im.setMatrixAt(i, zero);
    im.instanceMatrix.needsUpdate = true;
  }, [field, capacity]);
  return (
    <instancedMesh
      ref={(r) => {
        field.mesh.current = r;
      }}
      args={[geo, mat, capacity]}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}
