"use client";

import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Ink, useScene } from "../scene";
import { useStripeTexture } from "../textures";
import { Block, Cyl } from "./basics";

/*
 * Straight belt conveyor along +x. `travelRef` is the distance (scene units)
 * the belt surface has moved; the tread texture and rollers follow it, so the
 * owner decides when the line indexes forward.
 */

interface ConveyorProps {
  from: number;
  to: number;
  z?: number;
  /** Height of the belt surface. */
  top?: number;
  width?: number;
  travelRef: MutableRefObject<number>;
}

const TREAD = 0.55; // world units per tread stripe

export function Conveyor({ from, to, z = 0, top = 0.86, width = 1.7, travelRef }: ConveyorProps) {
  const { toon, palette } = useScene();
  const len = to - from;
  const cx = (from + to) / 2;
  const frameH = 0.34;
  const frameY = top - 0.06 - frameH / 2;

  const tread = useStripeTexture(palette.belt, palette.rubber, len / TREAD);
  const beltMat = useMemo(
    () => new THREE.MeshToonMaterial({ map: tread, gradientMap: toon("belt").gradientMap }),
    [tread, toon],
  );

  // legs + rollers as instances: two draw calls (+ outlines) for the whole run
  const legCount = Math.max(2, Math.round(len / 2.6) + 1);
  const legs = useRef<THREE.InstancedMesh>(null!);
  const rollers = useRef<THREE.InstancedMesh>(null!);
  const rollerCount = Math.max(2, Math.round(len / 0.9));
  const legGeo = useMemo(() => new THREE.BoxGeometry(0.16, frameY - frameH / 2, 0.16), [frameY]);
  const rollerGeo = useMemo(() => new THREE.CylinderGeometry(0.09, 0.09, width + 0.16, 12), [width]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const legH = frameY - frameH / 2;
    let i = 0;
    for (let k = 0; k < legCount; k++) {
      const x = from + 0.4 + ((len - 0.8) * k) / (legCount - 1);
      for (const s of [-1, 1]) {
        m.makeTranslation(x - cx, legH / 2 - frameY, s * (width / 2 - 0.12));
        legs.current.setMatrixAt(i++, m);
      }
    }
    legs.current.instanceMatrix.needsUpdate = true;
  }, [from, len, cx, legCount, width, frameY]);

  const rollerAngle = useRef(Number.NaN); // NaN: lay the rollers out on the first frame even if the belt never moves
  useFrame(() => {
    tread.offset.x = -(travelRef.current / TREAD) % 1;
    const a = travelRef.current / 0.09;
    if (Math.abs(a - rollerAngle.current) < 1e-4) return;
    rollerAngle.current = a;
    const m = new THREE.Matrix4();
    const r = new THREE.Matrix4();
    for (let k = 0; k < rollerCount; k++) {
      const x = from + 0.25 + ((len - 0.5) * k) / (rollerCount - 1);
      m.makeRotationX(Math.PI / 2);
      r.makeRotationZ(-a);
      m.premultiply(r);
      m.setPosition(x - cx, top - 0.12 - frameY, 0);
      rollers.current.setMatrixAt(k, m);
    }
    rollers.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[cx, frameY, z]}>
      {/* side rails */}
      <Block size={[len + 0.2, frameH, 0.16]} position-z={width / 2 + 0.02} color="steelDark" />
      <Block size={[len + 0.2, frameH, 0.16]} position-z={-width / 2 - 0.02} color="steelDark" />
      {/* belt */}
      <mesh position-y={top - frameY - 0.03} material={beltMat}>
        <boxGeometry args={[len, 0.06, width - 0.12]} />
      </mesh>
      {/* end drums */}
      <Cyl radius={0.2} height={width} rotation-x={Math.PI / 2} position={[-len / 2, top - frameY - 0.2, 0]} color="steel" />
      <Cyl radius={0.2} height={width} rotation-x={Math.PI / 2} position={[len / 2, top - frameY - 0.2, 0]} color="steel" />
      {/* rollers peeking under the belt */}
      <instancedMesh ref={rollers} args={[rollerGeo, toon("steel"), rollerCount]} />
      {/* legs */}
      <instancedMesh ref={legs} args={[legGeo, toon("steelDark"), legCount * 2]}>
        <Ink width={2} />
      </instancedMesh>
    </group>
  );
}
