"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, MapControls } from "@react-three/drei";
import {
  Block,
  Conveyor,
  DioramaBase,
  Hopper,
  RobotArm,
  SceneCanvas,
  Scanner,
  Sparks,
  StampPress,
  Terminal,
  ToonLights,
  mixHex,
  paintPad,
  roundRect,
  useCanvasTexture,
  useScene,
  type FloorPainter,
  type PaletteKey,
  type RobotArmHandle,
  type ScannerDrive,
} from "@/components/three";
import type { Frameloop } from "@/components/three/activity";
import type { AgentStatus, RoleKind, TaskStatus } from "@/types";
import {
  BELT_FROM,
  BELT_TO,
  BELT_TOP,
  CRATE_H,
  SLAB,
  STATIONS,
  STATION_BY_STATUS,
  type FactoryLayout,
} from "../factoryLayout";
import { FactoryContext, type FactoryRuntime, type HoverTarget } from "./runtime";
import { TaskCrate } from "./TaskCrate";
import { Andon, BlobFieldMesh, FactorySign, Pile, useBlobField, type AndonState } from "./props";

/*
 * Board "Fabrika" view: the live board as a toon diorama. Columns are
 * stations, tasks are crates; the store drives it (status change → the crate
 * rides the belt to its new station, a running agent works the DOING arm,
 * errors sound the andon + a beacon, budget overruns smoke).
 *
 * Render loop: `demand`. The scene only renders while something moves
 * (agents, transits, alarms, camera) and otherwise holds a still frame, so an
 * idle factory costs nothing on an iGPU.
 */

interface FactoryCopy {
  columns: Record<TaskStatus, string>;
  notes: Record<TaskStatus, string>;
  steps: Record<AgentStatus, string>;
  /** Team role names (DOING sign) and their live activity (crate label). */
  roles: Record<RoleKind, string>;
  activity: Record<RoleKind, string>;
  /** UI language, so sign text upper-cases with the right dotted/dotless I. */
  locale: "tr" | "en";
}

export interface FactoryCameraApi {
  reset: () => void;
  focus: (status: TaskStatus) => void;
}

interface BoardFactorySceneProps {
  layout: FactoryLayout;
  /** Changes on project / filter switches: crates then appear in place instead of dropping in. */
  epoch: string;
  frameloop: Frameloop;
  reducedMotion: boolean;
  fallback: ReactNode;
  label: string;
  copy: FactoryCopy;
  cameraRef: MutableRefObject<FactoryCameraApi | null>;
  onHover: (target: HoverTarget | null, x?: number, y?: number) => void;
  onMove: (x: number, y: number) => void;
  onOpen: (id: string) => void;
  onPile: (status: TaskStatus) => void;
  onReady?: () => void;
}

const BLOB_CAP = 96;
const ARM_Z = -2.05;
const LID_Y = BELT_TOP + CRATE_H;
const CENTER_X = (SLAB.x[0] + SLAB.x[1]) / 2;
const CENTER_Z = (SLAB.z[0] + SLAB.z[1]) / 2;

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export default function BoardFactoryScene(props: BoardFactorySceneProps) {
  const { frameloop, reducedMotion, fallback, label, onReady } = props;
  return (
    <SceneCanvas
      className="!absolute inset-0"
      frameloop={frameloop}
      reducedMotion={reducedMotion}
      fallback={fallback}
      label={label}
      onReady={onReady}
      adaptive={false}
      dpr={[1, 1.5]}
      onPointerMissed={() => props.onHover(null)}
      camera={{ fov: 30, position: [2, 22, 30], near: 1, far: 160 }}
    >
      <ToonLights />
      <World {...props} />
    </SceneCanvas>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

function World({ layout, epoch, copy, cameraRef, onHover, onMove, onOpen, onPile }: BoardFactorySceneProps) {
  const { clock, palette, colors, reducedMotion } = useScene();
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const [hover, setHover] = useState<HoverTarget | null>(null);

  const busy = useMemo(() => new Set<string>(), []);
  const riding = useMemo(() => new Set<string>(), []);
  const stampAt = useRef(-Infinity);
  const bornAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const hideMoversUntil = useRef(3);
  const keepUntil = useRef(0);
  const blobs = useBlobField(BLOB_CAP);

  useLayoutEffect(() => {
    bornAt.current = performance.now();
  }, [epoch]);

  /* shared PR stamp decal */
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
    `fstamp:${colors.red}:${colors.fontSans}`,
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

  const runtime = useMemo<FactoryRuntime>(
    () => ({
      busy,
      riding,
      stampAt,
      bornAt,
      blobs,
      hideMoversUntil,
      stampMat,
      kick: (ms) => {
        keepUntil.current = Math.max(keepUntil.current, performance.now() + ms);
        invalidate();
      },
      hover: (target, e) => {
        setHover(target);
        gl.domElement.style.cursor = target ? "pointer" : "";
        onHover(target, e?.nativeEvent.clientX, e?.nativeEvent.clientY);
      },
      move: (e) => onMove(e.nativeEvent.clientX, e.nativeEvent.clientY),
      open: onOpen,
      openPile: onPile,
    }),
    [busy, riding, blobs, stampMat, invalidate, gl, onHover, onMove, onOpen, onPile],
  );

  // the hovered crate may vanish (filters, deletes): drop the tooltip with it
  useEffect(() => {
    if (!hover) return;
    const alive =
      hover.kind === "crate"
        ? layout.crates.some((c) => c.id === hover.spec.id)
        : layout.piles.some((p) => p.status === hover.pile.status);
    if (!alive) runtime.hover(null);
  }, [layout, hover, runtime]);

  // blank the shadow slots no crate uses any more
  useLayoutEffect(() => {
    for (let i = layout.crates.length; i < BLOB_CAP; i++) blobs.set(i, 0, -10, 0, 0);
    invalidate();
  }, [layout, blobs, invalidate]);

  /* ── machine drives ─────────────────────────────────────────────────────── */
  const travel = useRef(0);
  const work = useRef(0); // 0..1 blend of the DOING arm into welding
  const armTarget = useRef(new THREE.Vector3(0, 3.3, 1));
  const armSpin = useRef(0.6);
  const armEyes = useRef(0);
  const sparkOrigin = useRef(new THREE.Vector3());
  const sparkActive = useRef(0);
  const arm = useRef<RobotArmHandle>(null);
  const scan = useRef<ScannerDrive>({ sweep: -0.6, beam: 0, pass: 0 });
  const press = useRef(0);
  const andon = useRef<AndonState>({ run: 0, queue: 0, alarm: 0 });
  const idle = useMemo(() => new THREE.Vector3(), []);
  const weld = useMemo(() => new THREE.Vector3(), []);

  const anySmoke = layout.crates.some((c) => c.smoke);
  const anyQueued = layout.crates.some((c) => c.queued);
  const live = useRef({ layout, anySmoke });
  live.current = { layout, anySmoke };

  useLayoutEffect(() => {
    invalidate();
  }, [layout, invalidate]);

  useFrame(() => {
    const t = clock.t;
    const dt = clock.dt;
    const L = live.current.layout;

    // belt moves while a crate rides it
    if (riding.size > 0) travel.current += dt * 3.1;

    // DOING arm eases into / out of the weld
    const goal = L.doingActive ? 1 : 0;
    work.current = reducedMotion ? goal : work.current + (goal - work.current) * (1 - Math.exp(-dt * 3));
    const w = work.current;
    idle.set(Math.sin(t * 0.9) * 0.3 * w, 3.25, 0.95);
    weld.set(Math.sin(t * 5.2) * 0.24, LID_Y + 0.62 + Math.sin(t * 11) * 0.03, -ARM_Z + Math.cos(t * 5.2) * 0.18);
    armTarget.current.copy(idle).lerp(weld, w);
    armSpin.current = 0.4 + w * 9;
    armEyes.current = w;
    sparkActive.current = w > 0.6 ? w : 0;
    arm.current?.tipWorld(sparkOrigin.current);

    andon.current.run = L.doingActive ? 1 : 0;
    andon.current.queue = anyQueued && !L.doingActive ? 1 : 0;
    andon.current.alarm = L.anyError ? 1 : 0;

    scan.current.beam = L.reviewWaiting ? 0.85 : 0;
    scan.current.sweep = L.reviewWaiting ? Math.sin(t * 0.8) * 0.8 : -0.6;
    scan.current.pass = 0;

    const d = t - stampAt.current;
    press.current =
      d < 0 ? 0 : d < 0.22 ? Math.pow(d / 0.22, 2) : d < 0.4 ? 1 : d < 0.85 ? 1 - easeInOut((d - 0.4) / 0.45) : 0;

    // keep the demand loop alive only while something moves
    const moving =
      busy.size > 0 ||
      L.running > 0 ||
      L.anyError ||
      live.current.anySmoke ||
      Math.abs(goal - w) > 0.004 ||
      d < 0.9 ||
      performance.now() < keepUntil.current;
    if (!reducedMotion && moving) invalidate();
  }, -5);

  /* ── floor print ────────────────────────────────────────────────────────── */
  const notesKey = `${copy.locale}|` + STATIONS.map((s) => `${copy.columns[s.status]}:${copy.notes[s.status]}`).join("|");
  const paint = useCallback(
    (p: FloorPainter) => {
      const { ctx, k, at } = p;
      STATIONS.forEach((s, i) => {
        const accent = palette[s.accent as PaletteKey];
        const zc = (s.padZ[0] + s.padZ[1]) / 2;
        const zd = s.padZ[1] - s.padZ[0];
        paintPad(p, s.x, zc, s.padW, zd, mixHex(palette.floor, accent, colors.night ? 0.2 : 0.22), accent);
        const [cx, cz] = at(s.x, s.padZ[1] + 0.42);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = palette.ink;
        ctx.font = `800 ${Math.round(k * 0.36)}px ${colors.fontSans}`;
        ctx.fillText(`${String(i + 1).padStart(2, "0")}  ${copy.columns[s.status].toLocaleUpperCase(copy.locale)}`, cx, cz);
        ctx.fillStyle = palette.ink3;
        ctx.font = `600 ${Math.round(k * 0.22)}px ${colors.fontMono}`;
        ctx.fillText(copy.notes[s.status].toLocaleUpperCase(copy.locale), cx, cz + k * 0.4);
        const next = STATIONS[i + 1];
        if (next) {
          const [ax, az] = at((s.x + s.padW / 2 + next.x - next.padW / 2) / 2, s.padZ[1] + 0.5);
          ctx.fillStyle = palette.ink2;
          ctx.font = `700 ${Math.round(k * 0.42)}px ${colors.fontSans}`;
          ctx.fillText("→", ax, az);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette, colors, notesKey],
  );

  // keep movers out of the one-frame contact-shadow bake (on mount + theme flips)
  const bakeKey = `${palette.outline}-${palette.floor}-${palette.slab}`;
  useLayoutEffect(() => {
    hideMoversUntil.current = clock.frame + 3;
  }, [bakeKey, clock]);

  const onColor = (accent: string): string => {
    switch (accent) {
      case "orange":
        return colors.onOrange;
      case "mustard":
        return colors.onMustard;
      case "green":
        return colors.onGreen;
      default:
        return colors.night ? palette.sunken : palette.panel; // on ink-3
    }
  };

  const stepCopies = useMemo(
    () => Object.fromEntries(Object.entries(copy.steps).map(([k, v]) => [k, { stepLabel: v }])) as Record<string, { stepLabel: string }>,
    [copy.steps],
  );
  const roleCopies = useMemo(
    () => Object.fromEntries(Object.entries(copy.activity).map(([k, v]) => [k, { stepLabel: v }])) as Record<string, { stepLabel: string }>,
    [copy.activity],
  );
  const doingX = STATION_BY_STATUS.doing.x;
  const hoveredId = hover?.kind === "crate" ? hover.spec.id : null;
  const hoveredPile = hover?.kind === "pile" ? hover.pile.status : null;
  const slabW = SLAB.x[1] - SLAB.x[0];
  const slabD = SLAB.z[1] - SLAB.z[0];

  return (
    <FactoryContext.Provider value={runtime}>
      <DioramaBase width={slabW} depth={slabD} center={[CENTER_X, CENTER_Z]} paint={paint} paintKey={notesKey} />
      <ContactShadows
        key={bakeKey}
        position={[CENTER_X, 0.012, CENTER_Z]}
        scale={[slabW - 0.6, slabD - 0.6]}
        resolution={1024}
        blur={2.2}
        far={5}
        opacity={colors.night ? 0.7 : 0.36}
        color={colors.night ? "#000000" : palette.ink}
        frames={1}
      />
      <BlobFieldMesh field={blobs} capacity={BLOB_CAP} />

      <Conveyor from={BELT_FROM} to={BELT_TO} top={BELT_TOP} travelRef={travel} />
      {/* chute off the end of the belt */}
      <Block size={[1.5, 0.08, 1.4]} position={[BELT_TO + 0.7, 0.62, 0]} rotation-z={-0.26} color="steel" />

      {STATIONS.map((s, i) => (
        <FactorySign
          key={s.status}
          position={[s.x, 0, -3.75]}
          kicker={
            s.status === "doing" && layout.doingRole
              ? `${String(i + 1).padStart(2, "0")} · ${layout.counts[s.status]} · ${copy.roles[layout.doingRole].toLocaleUpperCase(copy.locale)}`
              : `${String(i + 1).padStart(2, "0")} · ${layout.counts[s.status]}`
          }
          text={copy.columns[s.status].toLocaleUpperCase(copy.locale)}
          accent={s.accent as PaletteKey}
          on={onColor(s.accent)}
          width={Math.min(2.5, s.padW - 0.7)}
        />
      ))}

      {/* 01 TODO — intake hopper over the head of the belt */}
      <group position={[STATION_BY_STATUS.todo.x, 0, 0]} scale={0.78}>
        <Hopper bottomY={3.1} accent="ink3" />
      </group>

      {/* 02 DOING — the agent arm, its terminal and the andon tower */}
      <Terminal position={[doingX + 1.85, 0, -2.45]} rotationY={-0.3} activeRef={armEyes} />
      <Andon position={[doingX - 1.75, 0, -1.55]} stateRef={andon} />

      {/* 03 REVIEW — scanner */}
      <Scanner
        position={[STATION_BY_STATUS.review.x, 0, 0]}
        driveRef={scan}
        targetY={LID_Y}
        height={3.05}
        travel={0.4}
        reach={1.8}
      />

      {/* 04 DONE — stamp press */}
      <StampPress position={[STATION_BY_STATUS.done.x, 0, 0]} pressRef={press} contactY={LID_Y} topY={3.25} reach={1.8} />

      {/* movers — hidden during the shadow bake */}
      <Movers hideUntil={hideMoversUntil}>
        <RobotArm ref={arm} position={[doingX, 0, ARM_Z]} targetRef={armTarget} spinRef={armSpin} eyesRef={armEyes} />
        <Sparks originRef={sparkOrigin} activeRef={sparkActive} floorY={LID_Y - 0.05} />
      </Movers>

      {layout.crates.map((c, i) => (
        <TaskCrate
          key={c.id}
          spec={c}
          index={i}
          hovered={hoveredId === c.id}
          copy={c.working ? (c.role ? roleCopies[c.role] : stepCopies[c.step]) ?? NO_COPY : NO_COPY}
        />
      ))}

      {layout.piles.map((p) => (
        <Pile
          key={p.status}
          position={p.pos}
          count={p.count}
          hovered={hoveredPile === p.status}
          onOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            runtime.hover({ kind: "pile", pile: p }, e);
          }}
          onMove={(e) => {
            e.stopPropagation();
            runtime.move(e);
          }}
          onOut={() => runtime.hover(null)}
          onPick={() => runtime.openPile(p.status)}
        />
      ))}

      <CameraRig apiRef={cameraRef} reducedMotion={reducedMotion} />
    </FactoryContext.Provider>
  );
}

const NO_COPY = { stepLabel: "" };

function Movers({ hideUntil, children }: { hideUntil: MutableRefObject<number>; children: ReactNode }) {
  const g = useRef<THREE.Group>(null!);
  const { clock } = useScene();
  useFrame(() => {
    g.current.visible = clock.frame >= hideUntil.current;
  }, -4);
  return <group ref={g}>{children}</group>;
}

/* ════════════════════════════════════════════════════════════════════════
   Camera — map-style controls (drag pans the floor, right-drag tilts and
   turns a little, wheel zooms to the cursor), a fitted overview, and smooth
   fly-to for "reset" and station focus.
   ════════════════════════════════════════════════════════════════════════ */

type MapControlsImpl = ComponentRef<typeof MapControls>;

const VIEW_DIR = new THREE.Vector3(-0.42, 1.05, 1).normalize();
const FOCUS_DIR = new THREE.Vector3(-0.3, 0.95, 1).normalize();

function CameraRig({
  apiRef,
  reducedMotion,
}: {
  apiRef: MutableRefObject<FactoryCameraApi | null>;
  reducedMotion: boolean;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<MapControlsImpl>(null);
  const userMoved = useRef(false);
  const fly = useRef<{ fp: THREE.Vector3; ft: THREE.Vector3; tp: THREE.Vector3; tt: THREE.Vector3; t0: number; dur: number } | null>(
    null,
  );
  const [maxDist, setMaxDist] = useState(60);

  // overview: binary-search the distance that fits the slab and the sign tops
  const fitShot = useCallback(() => {
    const probe = new THREE.PerspectiveCamera(camera.fov, size.width / Math.max(1, size.height), 0.5, 300);
    const tgt = new THREE.Vector3(CENTER_X, 0.4, CENTER_Z + 0.3);
    const pts = [
      new THREE.Vector3(SLAB.x[0], 0, SLAB.z[1]),
      new THREE.Vector3(SLAB.x[1], 0, SLAB.z[1]),
      new THREE.Vector3(SLAB.x[0], 0, SLAB.z[0]),
      new THREE.Vector3(SLAB.x[1], 0, SLAB.z[0]),
      new THREE.Vector3(STATIONS[0].x, 4.6, -3.75),
      new THREE.Vector3(STATIONS[STATIONS.length - 1].x, 4.6, -3.75),
    ];
    const v = new THREE.Vector3();
    const fits = (d: number) => {
      probe.position.copy(tgt).addScaledVector(VIEW_DIR, d);
      probe.lookAt(tgt);
      probe.updateMatrixWorld();
      return pts.every((p) => {
        v.copy(p).project(probe);
        // leave room for the station chips (top) and the legend (bottom)
        return Math.abs(v.x) < 0.97 && v.y < 0.8 && v.y > -0.84;
      });
    };
    let lo = 8;
    let hi = 160;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const dist = hi;
    return { tgt, pos: tgt.clone().addScaledVector(VIEW_DIR, dist), dist };
  }, [size, camera]);

  const flyTo = useCallback(
    (tp: THREE.Vector3, tt: THREE.Vector3) => {
      const c = controls.current;
      if (!c) return;
      if (reducedMotion) {
        camera.position.copy(tp);
        c.target.copy(tt);
        c.update();
        invalidate();
        return;
      }
      fly.current = { fp: camera.position.clone(), ft: c.target.clone(), tp, tt, t0: performance.now(), dur: 750 };
      invalidate();
    },
    [camera, reducedMotion, invalidate],
  );

  // initial framing, and refit on resize until the user takes the camera
  useLayoutEffect(() => {
    const { tgt, pos, dist } = fitShot();
    setMaxDist(dist * 1.3);
    if (userMoved.current) return;
    camera.position.copy(pos);
    controls.current?.target.copy(tgt);
    controls.current?.update();
    invalidate();
  }, [fitShot, camera, invalidate]);

  useEffect(() => {
    apiRef.current = {
      reset: () => {
        userMoved.current = false;
        const { tgt, pos } = fitShot();
        flyTo(pos, tgt);
      },
      focus: (status) => {
        userMoved.current = true;
        const s = STATION_BY_STATUS[status];
        const tgt = new THREE.Vector3(s.x, 1.0, 0.7);
        flyTo(tgt.clone().addScaledVector(FOCUS_DIR, 21), tgt);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, fitShot, flyTo]);

  useFrame(() => {
    const f = fly.current;
    const c = controls.current;
    if (!f || !c) return;
    const u = Math.min(1, (performance.now() - f.t0) / f.dur);
    const k = easeInOut(u);
    camera.position.lerpVectors(f.fp, f.tp, k);
    c.target.lerpVectors(f.ft, f.tt, k);
    c.update();
    if (u >= 1) fly.current = null;
    invalidate();
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.12}
      screenSpacePanning={false}
      zoomToCursor
      minDistance={6}
      maxDistance={maxDist}
      minPolarAngle={0.32}
      maxPolarAngle={1.12}
      minAzimuthAngle={-0.8}
      maxAzimuthAngle={0.8}
      rotateSpeed={0.55}
      zoomSpeed={0.85}
      onStart={() => {
        userMoved.current = true;
        fly.current = null;
      }}
      onChange={() => {
        // keep the target over the slab
        const c = controls.current;
        if (!c) return;
        const t = c.target;
        const cx = THREE.MathUtils.clamp(t.x, SLAB.x[0] + 1, SLAB.x[1] - 1);
        const cz = THREE.MathUtils.clamp(t.z, SLAB.z[0], SLAB.z[1]);
        if (cx !== t.x || cz !== t.z) {
          camera.position.x += cx - t.x;
          camera.position.z += cz - t.z;
          t.x = cx;
          t.z = cz;
        }
      }}
    />
  );
}
