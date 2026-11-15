"use client";

import { Component, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { Frameloop } from "./activity";
import { SceneProvider } from "./scene";

/*
 * The one R3F canvas wrapper every scene uses. Load it (and the scene) through
 * next/dynamic with ssr:false. It owns:
 *  - DPR capped at [1, 1.75], dropped to 1 if the PerformanceMonitor sees a
 *    sustained fps decline
 *  - the frameloop chosen by the caller (`frameloopFor(useSceneActivity())`)
 *  - flat (no tone mapping) output so token hexes render as-is
 *  - fallback on render errors or a lost WebGL context
 */

export interface SceneCanvasProps {
  children: ReactNode;
  /** Shown if the renderer throws or the WebGL context is lost. */
  fallback: ReactNode;
  frameloop: Frameloop;
  reducedMotion: boolean;
  /** Scene-clock seconds shown as the still frame under reduced motion. */
  posterTime?: number;
  camera?: { fov?: number; position?: [number, number, number]; near?: number; far?: number };
  className?: string;
  /** Accessible description of the scene (the canvas is role="img"). */
  label: string;
  /** Fires after the first rendered frame. */
  onReady?: () => void;
  /** DPR range (default [1, 1.75]). */
  dpr?: [number, number];
  /**
   * Drop DPR to 1 on a sustained fps decline (default true). Turn off for
   * demand-driven scenes: sparse frames would read as a slow GPU.
   */
  adaptive?: boolean;
  /** Extra props for the canvas (pointer handlers etc.). */
  onPointerMissed?: (e: MouseEvent) => void;
}

const DPR_RANGE: [number, number] = [1, 1.75];

export default function SceneCanvas({
  children,
  fallback,
  frameloop,
  reducedMotion,
  posterTime,
  camera,
  className,
  label,
  onReady,
  dpr: dprRange = DPR_RANGE,
  adaptive = true,
  onPointerMissed,
}: SceneCanvasProps) {
  const [failed, setFailed] = useState(false);
  const [dpr, setDpr] = useState<number | [number, number]>(dprRange);

  if (failed) return <>{fallback}</>;

  return (
    <SceneBoundary fallback={fallback} onError={() => setFailed(true)}>
      <Canvas
        className={className}
        role="img"
        aria-label={label}
        dpr={dpr}
        flat
        frameloop={frameloop}
        onPointerMissed={onPointerMissed}
        camera={{ fov: 30, near: 0.5, far: 120, position: [0, 8, 18], ...camera }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.domElement.addEventListener(
            "webglcontextlost",
            (e) => {
              e.preventDefault();
              setFailed(true);
            },
            { once: true },
          );
        }}
      >
        <SceneProvider reducedMotion={reducedMotion} posterTime={posterTime}>
          {adaptive && !reducedMotion && (
            <PerformanceMonitor flipflops={2} onDecline={() => setDpr(1)} onFallback={() => setDpr(1)} />
          )}
          {onReady && <FirstFrame onReady={onReady} />}
          {children}
        </SceneProvider>
      </Canvas>
    </SceneBoundary>
  );
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  const frames = useRef(0);
  useFrame(() => {
    // wait two frames so one-shot bakes (contact shadows) are in
    if (done.current || ++frames.current < 2) return;
    done.current = true;
    onReady();
  });
  return null;
}

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { error: boolean }
> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[3D] scene failed, showing fallback:", error.message, info.componentStack?.slice(0, 200));
    this.props.onError();
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
