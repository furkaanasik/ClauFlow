"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import { useScene } from "../scene";
import { roundRect, useCanvasTexture, useLabelTexture } from "../textures";
import { Ball, Block, RBlock, sharedPlane } from "./basics";

/*
 * A task crate. Its states are driven from outside through the handle so a
 * scene can animate many crates from one timeline:
 *   body   — squash/stretch group
 *   band   — cobalt "code" band painted on at DOING (scale.x 0→1)
 *   check  — green review pass badge (scale)
 *   decal  — red "PR" stamp on the lid (visible)
 *   ribbon — green wrap bands (scale.y 0→1), bow (scale)
 */

export const CRATE_SIZE: [number, number, number] = [1.3, 1, 1.3];

export interface CrateHandle {
  root: THREE.Group;
  body: THREE.Group;
  band: THREE.Group;
  check: THREE.Group;
  decal: THREE.Mesh;
  ribbon: THREE.Group;
  bow: THREE.Group;
}

export interface CrateProps {
  /** Key printed on the front label, e.g. "CLF-87". */
  label: string;
  position?: [number, number, number];
  scale?: number;
  /** Static crates (backlog piles) can skip the animated extras. */
  extras?: boolean;
}

const [W, H, D] = CRATE_SIZE;

export const Crate = forwardRef<CrateHandle, CrateProps>(function Crate(
  { label, position, scale = 1, extras = true },
  ref,
) {
  const { palette, colors } = useScene();
  const root = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const band = useRef<THREE.Group>(null!);
  const check = useRef<THREE.Group>(null!);
  const decal = useRef<THREE.Mesh>(null!);
  const ribbon = useRef<THREE.Group>(null!);
  const bow = useRef<THREE.Group>(null!);

  useImperativeHandle(ref, () => ({
    root: root.current,
    body: body.current,
    band: band.current,
    check: check.current,
    decal: decal.current,
    ribbon: ribbon.current,
    bow: bow.current,
  }));

  const labelTex = useLabelTexture({
    text: label,
    bg: palette.stock,
    fg: palette.print,
    border: palette.outline,
    font: colors.fontMono,
    weight: 800,
    size: 0.5,
    w: 384,
    h: 160,
  });
  const labelMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: labelTex, toneMapped: false }),
    [labelTex],
  );

  const stampTex = useCanvasTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.18);
      ctx.strokeStyle = colors.red;
      ctx.lineWidth = 16;
      roundRect(ctx, -w * 0.38, -h * 0.26, w * 0.76, h * 0.52, 26);
      ctx.stroke();
      ctx.fillStyle = colors.red;
      ctx.font = `900 ${Math.round(h * 0.36)}px ${colors.fontSans}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PR", 0, h * 0.02);
      ctx.restore();
    },
    256,
    256,
    `stamp:${colors.red}:${colors.fontSans}`,
  );
  const stampMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: stampTex,
        transparent: true,
        toneMapped: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    [stampTex],
  );

  const checkTex = useCanvasTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = palette.outline;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.green;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors.onGreen;
      ctx.lineWidth = w * 0.1;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(w * 0.3, h * 0.52);
      ctx.lineTo(w * 0.44, h * 0.66);
      ctx.lineTo(w * 0.71, h * 0.36);
      ctx.stroke();
    },
    128,
    128,
    `check:${colors.green}:${palette.outline}:${colors.onGreen}`,
  );
  const checkMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, toneMapped: false, depthTest: false }),
    [checkTex],
  );

  return (
    <group ref={root} position={position} scale={scale}>
      {/* squash pivot sits on the crate's floor */}
      <group ref={body} position-y={-H / 2}>
        <group position-y={H / 2}>
          <RBlock size={CRATE_SIZE} radius={0.07} color="kraft" />
          {/* lid tape */}
          <Block size={[W + 0.02, 0.03, 0.3]} position-y={H / 2 + 0.005} color="kraftDark" ink={false} />
          {/* front label */}
          <mesh geometry={sharedPlane()} material={labelMat} position={[0, 0.08, D / 2 + 0.006]} scale={[0.86, 0.36, 1]} />

          {extras && (
            <>
              {/* code band (DOING) */}
              <group ref={band} position-y={-0.24} scale={[0.001, 1, 1]}>
                <Block size={[W + 0.03, 0.16, D + 0.03]} color="cobalt" ink={1.5} />
              </group>

              {/* PR stamp on the lid (DONE) */}
              <mesh
                ref={decal}
                geometry={sharedPlane()}
                material={stampMat}
                position={[0.18, H / 2 + 0.03, 0.12]}
                rotation-x={-Math.PI / 2}
                scale={[0.78, 0.78, 1]}
                visible={false}
                renderOrder={2}
              />

              {/* wrap ribbon (DONE) — grows from the floor up */}
              <group ref={ribbon} position-y={-H / 2} scale={[1, 0.001, 1]}>
                <group position-y={H / 2}>
                  <Block size={[W + 0.05, H + 0.05, 0.2]} color="green" ink={1.5} />
                  <Block size={[0.2, H + 0.05, D + 0.05]} color="green" ink={1.5} />
                </group>
              </group>
              <group ref={bow} position-y={H / 2 + 0.1} scale={0.001}>
                <Ball radius={0.16} position={[-0.17, 0.02, 0]} scale={[0.2, 0.12, 0.13]} color="green" ink={1.5} />
                <Ball radius={0.16} position={[0.17, 0.02, 0]} scale={[0.2, 0.12, 0.13]} color="green" ink={1.5} />
                <Ball radius={0.08} scale={0.09} color="green" ink={1.5} />
              </group>
            </>
          )}
        </group>
      </group>

      {extras && (
        <group ref={check} position-y={H + 0.55} scale={0.001}>
          <Billboard>
            <mesh geometry={sharedPlane()} material={checkMat} scale={0.62} renderOrder={5} />
          </Billboard>
        </group>
      )}
    </group>
  );
});
