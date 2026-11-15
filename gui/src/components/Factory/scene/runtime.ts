import { createContext, useContext, type MutableRefObject } from "react";
import type * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { CrateSpec, PileSpec } from "../factoryLayout";
import type { BlobField } from "./props";

/*
 * Shared, mutable runtime of the board factory scene. Refs (not state) so
 * per-frame animation never re-renders React.
 */

export interface FactoryRuntime {
  /** Crates with a transit / drop in flight. Keeps the demand loop alive. A set, so React
   *  StrictMode's mount → unmount → mount replay can't unbalance it. */
  busy: Set<string>;
  /** Crates currently riding the belt — the tread moves while non-empty. */
  riding: Set<string>;
  /** Scene-clock time the stamp press last started a hit (−Infinity = never). */
  stampAt: MutableRefObject<number>;
  /** Wall-clock ms of the last layout epoch (mount, project or filter change): crates mounting right after it appear in place instead of dropping in. */
  bornAt: MutableRefObject<number>;
  blobs: BlobField;
  /** Movers are hidden until this scene frame (keeps them out of the contact-shadow bake). */
  hideMoversUntil: MutableRefObject<number>;
  /** Keep the demand loop running for a short tail (hover tween, landing squash). */
  kick: (ms: number) => void;
  /** Shared red "PR" stamp decal. */
  stampMat: THREE.Material;
  hover: (target: HoverTarget | null, e?: ThreeEvent<PointerEvent>) => void;
  move: (e: ThreeEvent<PointerEvent>) => void;
  open: (id: string) => void;
  openPile: (status: PileSpec["status"]) => void;
}

export type HoverTarget = { kind: "crate"; spec: CrateSpec } | { kind: "pile"; pile: PileSpec };

export const FactoryContext = createContext<FactoryRuntime | null>(null);

export function useFactory(): FactoryRuntime {
  const ctx = useContext(FactoryContext);
  if (!ctx) throw new Error("useFactory must be used inside the board factory scene");
  return ctx;
}
