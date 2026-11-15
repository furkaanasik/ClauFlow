"use client";

import { forwardRef, useImperativeHandle, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { Ink, useScene } from "../scene";
import type { PaletteKey } from "../palette";
import { Ball, Block, Cyl, RBlock } from "./basics";

/*
 * The agent: a two-link arm with a friendly visor head and a welding nozzle.
 * Drive it with `targetRef` (wrist target in the arm's local space, +z is
 * "towards the belt"); it solves a planar 2-bone IK with turret yaw and keeps
 * the head level. `spinRef` is the gear speed in rad/s.
 */

export interface RobotArmHandle {
  /** World position of the nozzle tip (sparks spawn here). */
  tipWorld: (out: THREE.Vector3) => THREE.Vector3;
}

interface RobotArmProps {
  position?: [number, number, number];
  rotationY?: number;
  targetRef: MutableRefObject<THREE.Vector3>;
  spinRef?: MutableRefObject<number>;
  accent?: PaletteKey;
  /** Eye colour — lit while working. */
  eyesRef?: MutableRefObject<number>;
}

export const ARM = { L1: 1.9, L2: 1.55, shoulderY: 1.05, tipBelowWrist: 0.62 };

/* ── gear geometry ───────────────────────────────────────────────────────── */

const gearCache = new Map<string, THREE.ExtrudeGeometry>();
export function gearGeometry(teeth: number, r: number, depth = 0.12): THREE.ExtrudeGeometry {
  const key = `${teeth}|${r}|${depth}`;
  const hit = gearCache.get(key);
  if (hit) return hit;
  const shape = new THREE.Shape();
  const inner = r * 0.78;
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const phase = i % 4;
    const rad = phase === 1 || phase === 2 ? r : inner;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.3, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // axis along x
  gearCache.set(key, g);
  return g;
}

export const Gear = forwardRef<
  THREE.Mesh,
  { teeth?: number; radius?: number; color?: PaletteKey } & Omit<ThreeElements["mesh"], "args" | "ref">
>(function Gear({ teeth = 10, radius = 0.4, color = "mustard", ...rest }, ref) {
  const { toon } = useScene();
  return (
    <mesh ref={ref} geometry={gearGeometry(teeth, radius)} material={toon(color)} {...rest}>
      <Ink width={2} />
    </mesh>
  );
});

/* ── IK ──────────────────────────────────────────────────────────────────── */

export function solveArm(target: THREE.Vector3) {
  const { L1, L2, shoulderY } = ARM;
  const yaw = Math.atan2(target.x, target.z);
  const r = Math.hypot(target.x, target.z);
  const dy = target.y - shoulderY;
  const d = THREE.MathUtils.clamp(Math.hypot(dy, r), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const cosE = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
  const a2 = Math.PI - Math.acos(THREE.MathUtils.clamp(cosE, -1, 1));
  const alpha = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const phi = Math.atan2(r, dy);
  return { yaw, a1: phi - alpha, a2 };
}

/* ── arm ─────────────────────────────────────────────────────────────────── */

export const RobotArm = forwardRef<RobotArmHandle, RobotArmProps>(function RobotArm(
  { position, rotationY = 0, targetRef, spinRef, accent = "orange", eyesRef },
  ref,
) {
  const { clock, basic } = useScene();
  const turret = useRef<THREE.Group>(null!);
  const shoulder = useRef<THREE.Group>(null!);
  const elbow = useRef<THREE.Group>(null!);
  const wrist = useRef<THREE.Group>(null!);
  const tip = useRef<THREE.Group>(null!);
  const gearA = useRef<THREE.Mesh>(null!);
  const gearB = useRef<THREE.Mesh>(null!);
  const eyeL = useRef<THREE.Mesh>(null!);
  const eyeR = useRef<THREE.Mesh>(null!);
  const gearAngle = useRef(0);

  useImperativeHandle(ref, () => ({
    tipWorld: (out) => tip.current.getWorldPosition(out),
  }));

  useFrame(() => {
    const { yaw, a1, a2 } = solveArm(targetRef.current);
    turret.current.rotation.y = yaw;
    shoulder.current.rotation.x = a1;
    elbow.current.rotation.x = a2;
    wrist.current.rotation.x = -(a1 + a2);
    gearAngle.current += clock.dt * (spinRef?.current ?? 1);
    gearA.current.rotation.x = gearAngle.current;
    gearB.current.rotation.x = -gearAngle.current * 1.6;
    const lit = (eyesRef?.current ?? 0) > 0.5;
    const eyeMat = basic(lit ? "mustard" : "stock");
    eyeL.current.material = eyeMat;
    eyeR.current.material = eyeMat;
  });

  const { L1, L2 } = ARM;

  return (
    <group position={position} rotation-y={rotationY}>
      <Cyl radius={[0.62, 0.7]} height={0.3} position-y={0.15} color="steel" />
      <group ref={turret} position-y={0.3}>
        <Cyl radius={[0.4, 0.48]} height={0.5} position-y={0.25} color={accent} />
        <group ref={shoulder} position-y={0.75}>
          <Cyl radius={0.27} height={0.72} rotation-z={Math.PI / 2} color="steelDark" />
          <Gear ref={gearA} radius={0.42} teeth={11} position-x={0.44} color="mustard" />
          <RBlock size={[0.34, L1, 0.34]} radius={0.1} position-y={L1 / 2} color={accent} />
          <group ref={elbow} position-y={L1}>
            <Cyl radius={0.21} height={0.52} rotation-z={Math.PI / 2} color="steelDark" />
            <Gear ref={gearB} radius={0.26} teeth={8} position-x={-0.32} color="mustard" />
            <RBlock size={[0.27, L2, 0.27]} radius={0.09} position-y={L2 / 2} color={accent} />
            <group ref={wrist} position-y={L2}>
              {/* head */}
              <RBlock size={[0.8, 0.54, 0.64]} radius={0.14} color="stock" />
              <Block size={[0.62, 0.22, 0.05]} position={[0, 0.04, 0.32]} color="ink" ink={false} />
              <mesh ref={eyeL} position={[-0.14, 0.04, 0.35]} material={basic("mustard")}>
                <boxGeometry args={[0.1, 0.1, 0.02]} />
              </mesh>
              <mesh ref={eyeR} position={[0.14, 0.04, 0.35]} material={basic("mustard")}>
                <boxGeometry args={[0.1, 0.1, 0.02]} />
              </mesh>
              <Cyl radius={0.025} height={0.3} position-y={0.42} color="steelDark" ink={1.5} />
              <Ball radius={0.08} position-y={0.6} color={accent} ink={1.5} />
              {/* nozzle */}
              <Cyl radius={[0.16, 0.06]} height={0.36} position-y={-0.44} color="steelDark" />
              <group ref={tip} position-y={-ARM.tipBelowWrist} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
});
