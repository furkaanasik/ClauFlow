"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import { Block, Ink, roundRect, useCanvasTexture, useScene, sharedPlane } from "@/components/three";
import { StatusPill } from "@/components/ui/Pills";
import type { TaskStatus } from "@/types";
import { BELT_FROM, BELT_TO, BELT_TOP, CRATE_H, CRATE_SCALE, beltX, type CrateSpec } from "../factoryLayout";
import { useFactory } from "./runtime";
import { Beacon, Smoke } from "./props";

/*
 * One task = one crate. It rests at the slot the layout gives it; when the
 * task's status changes it hops onto the belt, rides to the new station
 * (pausing under the press on its way into DONE) and hops down to its slot.
 * Everything is driven by the scene clock, so reduced motion simply snaps.
 */

const W = 1.3;
const H = 1;
const D = 1.3;
const BELT_Y = BELT_TOP + CRATE_H / 2;

type SegKind = "hop" | "slide" | "dwell" | "drop";
interface Seg {
  a: THREE.Vector3;
  b: THREE.Vector3;
  dur: number;
  kind: SegKind;
}
interface Motion {
  segs: Seg[];
  t0: number;
  total: number;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function hop(a: THREE.Vector3, b: THREE.Vector3): Seg {
  return { a, b, dur: 0.36 + Math.min(a.distanceTo(b), 4) * 0.07, kind: "hop" };
}

function beltRoute(from: THREE.Vector3, fromStatus: TaskStatus, to: THREE.Vector3, toStatus: TaskStatus): Seg[] {
  const p1 = new THREE.Vector3(beltX(fromStatus), BELT_Y, 0);
  const p2 = new THREE.Vector3(beltX(toStatus), BELT_Y, 0);
  const segs: Seg[] = [];
  if (from.distanceTo(p1) > 0.05) segs.push(hop(from, p1));
  const dx = Math.abs(p2.x - p1.x);
  segs.push({ a: p1, b: p2, dur: THREE.MathUtils.clamp(0.3 + dx * 0.085, 0.45, 2.2), kind: "slide" });
  if (toStatus === "done") segs.push({ a: p2, b: p2, dur: 0.8, kind: "dwell" });
  if (to.distanceTo(p2) > 0.05) segs.push(hop(p2, to));
  return segs;
}

function onBeltAt(x: number, z: number) {
  return Math.abs(z) < 0.9 && x > BELT_FROM && x < BELT_TO;
}

export interface CrateCopy {
  stepLabel: string;
}

export const TaskCrate = memo(function TaskCrate({
  spec,
  index,
  hovered,
  copy,
}: {
  spec: CrateSpec;
  /** Slot in the blob-shadow field. */
  index: number;
  hovered: boolean;
  copy: CrateCopy;
}) {
  const { palette, colors, toon, clock, reducedMotion } = useScene();
  const rt = useFactory();
  const invalidate = useThree((s) => s.invalidate);

  const root = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const decal = useRef<THREE.Mesh>(null);
  const ribbon = useRef<THREE.Group>(null);

  const pos = useRef(new THREE.Vector3(...spec.pos));
  const motion = useRef<Motion | null>(null);
  const prevStatus = useRef<TaskStatus | null>(null);
  const landAt = useRef(-Infinity);
  const riding = useRef(false);
  const stampedAt = useRef(-Infinity);
  const yaw = useMemo(() => (hash(spec.id) - 0.5) * 0.22, [spec.id]);

  /* ── react to a new rest position / status ─────────────────────────────── */
  const [tx, ty, tz] = spec.pos;
  useLayoutEffect(() => {
    const target = new THREE.Vector3(tx, ty, tz);
    const begin = (segs: Seg[]) => {
      rt.busy.add(spec.id);
      motion.current = { segs, t0: clock.t, total: segs.reduce((s, x) => s + x.dur, 0) };
      invalidate();
    };

    if (prevStatus.current === null) {
      prevStatus.current = spec.status;
      if (reducedMotion || performance.now() - rt.bornAt.current < 900) {
        pos.current.copy(target);
        invalidate();
        return;
      }
      // a new task drops in from above
      pos.current.copy(target).setY(target.y + 3.4);
      begin([{ a: pos.current.clone(), b: target, dur: 0.55, kind: "drop" }]);
      return;
    }

    const from = pos.current.clone();
    const statusChanged = prevStatus.current !== spec.status;
    const fromStatus = prevStatus.current;
    prevStatus.current = spec.status;
    if (reducedMotion) {
      rt.busy.delete(spec.id);
      motion.current = null;
      pos.current.copy(target);
      invalidate();
      return;
    }
    if (from.distanceTo(target) < 1e-3) return;
    begin(statusChanged ? beltRoute(from, fromStatus, target, spec.status) : [hop(from, target)]);
    // spec.status is read through prevStatus; positions are the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, ty, tz, spec.status]);

  // registered while in flight; re-registered by the frame loop after a StrictMode replay
  useLayoutEffect(() => {
    const id = spec.id;
    return () => {
      rt.busy.delete(id);
      rt.riding.delete(id);
      riding.current = false;
    };
  }, [rt, spec.id]);

  useLayoutEffect(() => {
    rt.kick(220);
  }, [hovered, rt]);

  /* ── per frame ─────────────────────────────────────────────────────────── */
  useFrame(() => {
    const t = clock.t;
    const m = motion.current;
    let ride = false;
    let wrap = spec.status === "done" ? 1 : 0;
    let stamp = spec.status === "done";
    let tilt = 0;

    if (m) {
      rt.busy.add(spec.id);
      let e = Math.max(0, t - m.t0);
      if (e >= m.total) {
        pos.current.copy(m.segs[m.segs.length - 1].b);
        motion.current = null;
        rt.busy.delete(spec.id);
        landAt.current = t;
        rt.kick(300);
      } else {
        let i = 0;
        while (i < m.segs.length - 1 && e > m.segs[i].dur) {
          e -= m.segs[i].dur;
          i++;
        }
        const s = m.segs[i];
        const u = Math.min(1, e / s.dur);
        const into = m.segs.some((x) => x.kind === "dwell");
        if (s.kind === "hop") {
          const k = easeInOut(u);
          pos.current.lerpVectors(s.a, s.b, k);
          pos.current.y += Math.sin(Math.PI * u) * (0.45 + Math.min(s.a.distanceTo(s.b), 4) * 0.12);
          tilt = Math.sin(Math.PI * u) * 0.12 * Math.sign(s.b.x - s.a.x || 1);
        } else if (s.kind === "slide") {
          pos.current.lerpVectors(s.a, s.b, easeInOut(u));
          ride = true;
        } else if (s.kind === "drop") {
          pos.current.lerpVectors(s.a, s.b, u * u);
        } else {
          pos.current.copy(s.a);
          if (stampedAt.current < m.t0) {
            stampedAt.current = t;
            rt.stampAt.current = t;
          }
        }
        if (into) {
          // DONE treatment builds up during the dwell under the press
          const di = m.segs.findIndex((x) => x.kind === "dwell");
          const before = m.segs.slice(0, di).reduce((acc, x) => acc + x.dur, 0);
          const local = t - m.t0 - before;
          stamp = local > 0.26;
          wrap = THREE.MathUtils.clamp((local - 0.36) / 0.34, 0, 1);
        }
      }
    }

    if (ride !== riding.current) {
      if (ride) rt.riding.add(spec.id);
      else rt.riding.delete(spec.id);
      riding.current = ride;
    }

    // landing squash; welding jitter on the work spot
    const v = (t - landAt.current) / 0.24;
    const sq = v >= 0 && v < 1 ? 1 - 0.16 * Math.sin(Math.PI * v) : 1;
    const jitter = spec.working && spec.onBelt && !m ? Math.sin(t * 38) * 0.012 : 0;

    const lift = hovered && !m ? 0.12 : 0;
    root.current.position.set(pos.current.x, pos.current.y + lift, pos.current.z);
    root.current.rotation.set(jitter, spec.onBelt || m ? 0 : yaw, tilt + jitter);
    body.current.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
    root.current.visible = clock.frame >= rt.hideMoversUntil.current;

    if (decal.current) decal.current.visible = stamp;
    if (ribbon.current) {
      ribbon.current.scale.y = Math.max(wrap, 0.0001);
      ribbon.current.visible = wrap > 0.001;
    }

    // blob shadow on whatever is underneath (none for stacked crates at rest)
    const restY = spec.pos[1];
    const stacked = !m && restY > CRATE_H;
    const floor = onBeltAt(pos.current.x, pos.current.z) ? BELT_TOP + 0.012 : 0.012;
    const above = Math.max(0, pos.current.y - CRATE_H / 2 - floor);
    const size = stacked ? 0 : 1.3 * Math.max(0.35, 1 - above * 0.18);
    rt.blobs.set(index, pos.current.x, floor, pos.current.z, size);
  });

  /* ── label: key + title on the front face ──────────────────────────────── */
  const labelTex = useCanvasTexture(
    (ctx, w, h) => {
      const bw = 10;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = palette.outline;
      roundRect(ctx, 0, 0, w, h, 26);
      ctx.fill();
      ctx.fillStyle = palette.stock;
      roundRect(ctx, bw, bw, w - bw * 2, h - bw * 2, 18);
      ctx.fill();
      ctx.fillStyle = palette.print;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = `800 ${Math.round(h * 0.29)}px ${colors.fontMono}`;
      ctx.fillText(spec.key, w * 0.08, h * 0.27);
      // rule
      ctx.fillStyle = palette.outline;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(w * 0.08, h * 0.47, w * 0.84, 4);
      ctx.globalAlpha = 1;
      // title, two lines with an ellipsis
      ctx.fillStyle = palette.print;
      ctx.font = `600 ${Math.round(h * 0.15)}px ${colors.fontSans}`;
      const maxW = w * 0.84;
      const words = spec.title.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= maxW) line = next;
        else {
          if (line) lines.push(line);
          line = word;
          if (lines.length === 2) break;
        }
      }
      if (lines.length < 2 && line) lines.push(line);
      if (lines.length > 2) lines.length = 2;
      const usedAll = lines.join(" ").length >= spec.title.trim().length;
      if (!usedAll && lines.length) {
        let last = lines[lines.length - 1];
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
        lines[lines.length - 1] = `${last}…`;
      }
      lines.forEach((l, i) => ctx.fillText(l, w * 0.08, h * (0.64 + i * 0.18)));
    },
    384,
    240,
    `crate:${spec.key}:${spec.title}:${palette.stock}:${palette.print}:${palette.outline}:${colors.fontSans}`,
  );
  const labelMat = useMemo(() => new THREE.MeshBasicMaterial({ map: labelTex, toneMapped: false }), [labelTex]);

  const lidY = H;

  return (
    <group
      ref={root}
      scale={CRATE_SCALE}
      onPointerOver={(e) => {
        e.stopPropagation();
        rt.hover({ kind: "crate", spec }, e);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        rt.move(e);
      }}
      onPointerOut={() => rt.hover(null)}
      onClick={(e) => {
        if (e.delta > 5) return;
        e.stopPropagation();
        rt.open(spec.id);
      }}
    >
      {/* squash pivot on the crate floor */}
      <group ref={body} position-y={-H / 2}>
        <group position-y={H / 2}>
          <RoundedBox args={[W, H, D]} radius={0.07} smoothness={2} material={toon("kraft")}>
            <Ink width={hovered ? 3.25 : 2} color={hovered ? "cobalt" : spec.error ? "red" : "outline"} />
          </RoundedBox>
          <Block size={[W + 0.02, 0.03, 0.3]} position-y={H / 2 + 0.005} color="kraftDark" ink={false} />
          <mesh geometry={sharedPlane()} material={labelMat} position={[0, 0.02, D / 2 + 0.008]} scale={[1.14, 0.71, 1]} />

          {spec.status === "done" && (
            <>
              <group ref={ribbon} position-y={-H / 2}>
                <group position-y={H / 2}>
                  <Block size={[0.2, H + 0.05, D + 0.05]} position-x={-0.42} color="green" ink={1.5} />
                </group>
              </group>
              <mesh
                ref={decal}
                geometry={sharedPlane()}
                material={rt.stampMat}
                position={[0.12, H / 2 + 0.03, -0.05]}
                rotation-x={-Math.PI / 2}
                scale={[0.86, 0.86, 1]}
                renderOrder={2}
              />
            </>
          )}
        </group>
      </group>

      {spec.error && <Beacon y={lidY} ringY={-H / 2 + 0.02} />}
      {spec.smoke && <Smoke y={lidY} />}

      {spec.working && (
        <Html position={[0, lidY + 1.45, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
          <span className="factory-step">
            <StatusPill status="doing" live size="sm">
              {copy.stepLabel}
            </StatusPill>
          </span>
        </Html>
      )}
    </group>
  );
});
