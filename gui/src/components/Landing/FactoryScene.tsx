"use client";

import { useCallback, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import {
  Bin,
  Blob,
  Block,
  Conveyor,
  Crate,
  DioramaBase,
  Hopper,
  RobotArm,
  SceneCanvas,
  Scanner,
  Sparks,
  StampPress,
  StationSign,
  Terminal,
  ToonLights,
  paintPad,
  mixHex,
  useScene,
  STATION_ACCENT,
  type CrateHandle,
  type FloorPainter,
  type RobotArmHandle,
  type ScannerDrive,
  type StationKind,
} from "@/components/three";
import type { Frameloop } from "@/components/three/activity";
import { STATION_KINDS, STATION_X, clamp01, focusX, smooth } from "./factoryLine";

/*
 * Landing hero: the "agent factory". Crates (tasks) index along a belt
 * through TODO → DOING → REVIEW → DONE. Every station works on its crate
 * during the dwell, then the whole line advances one slot — a seamless loop
 * derived purely from the scene clock (so the reduced-motion poster frame is
 * just one moment of the same timeline).
 */

export interface FactoryDrive {
  /** 0..1 scroll progress through the hero. */
  progress: number;
  /** Pointer, -1..1 from the viewport centre. */
  px: number;
  py: number;
  /** Fraction of the viewport height the scene is pushed down at progress 0 (room for the copy). */
  shiftY: number;
}

interface FactoryStationCopy {
  name: string;
  note: string;
}

const STATIONS: readonly StationKind[] = STATION_KINDS;
const SX = STATION_X;
const SPACING = 5;
const BELT_TOP = 0.86;
const CRATE_Y = BELT_TOP + 0.5;
const LID_Y = BELT_TOP + 1;
const PERIOD = 4.2; // seconds per index step
const MOVE = 0.27; // fraction of the period spent moving
const POOL = 5;
const LABELS = ["CLF-87", "CLF-88", "CLF-91", "CLF-94", "CLF-96"];
const ARM_Z = -2.05;
const BIN_X = 11.75;

/** A moment where every station is mid-action — the reduced-motion still. */
const POSTER_TIME = PERIOD * 12 + PERIOD * (MOVE + (1 - MOVE) * 0.5);

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export default function FactoryScene({
  driveRef,
  frameloop,
  reducedMotion,
  fallback,
  label,
  stations,
  onReady,
}: {
  driveRef: MutableRefObject<FactoryDrive>;
  frameloop: Frameloop;
  reducedMotion: boolean;
  fallback: ReactNode;
  label: string;
  stations: FactoryStationCopy[];
  onReady?: () => void;
}) {
  return (
    <SceneCanvas
      className="!absolute inset-0"
      frameloop={frameloop}
      reducedMotion={reducedMotion}
      posterTime={POSTER_TIME}
      fallback={fallback}
      label={label}
      onReady={onReady}
      camera={{ fov: 28, position: [6, 16, 32] }}
    >
      <ToonLights />
      <Factory stations={stations} />
      <CameraRig driveRef={driveRef} reducedMotion={reducedMotion} />
    </SceneCanvas>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

function Factory({ stations }: { stations: FactoryStationCopy[] }) {
  const { clock, palette, colors } = useScene();

  // drives shared with the machines
  const travel = useRef(0);
  const armTarget = useRef(new THREE.Vector3(0, 3.4, 1));
  const armSpin = useRef(1);
  const armEyes = useRef(0);
  const sparkOrigin = useRef(new THREE.Vector3());
  const sparkActive = useRef(0);
  const scan = useRef<ScannerDrive>({ sweep: -1, beam: 0, pass: 0 });
  const press = useRef(0);
  const arm = useRef<RobotArmHandle>(null);
  const crates = useRef<(CrateHandle | null)[]>([]);
  const blobs = useRef<(THREE.Mesh | null)[]>([]);
  const movers = useRef<THREE.Group>(null!);

  const idle = useMemo(() => new THREE.Vector3(), []);
  const weld = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const t = clock.t;
    const cyc = t / PERIOD;
    const c = Math.floor(cyc);
    const u = cyc - c;
    const moving = u < MOVE;
    const g = moving ? u / MOVE : 1;
    const mv = easeInOut(g);
    const d = moving ? 0 : (u - MOVE) / (1 - MOVE);

    travel.current = (c + mv) * SPACING;

    /* DOING — the agent welds */
    const work = moving ? 0 : smooth(0.02, 0.12, d) * (1 - smooth(0.8, 0.92, d));
    idle.set(Math.sin(t * 0.9) * 0.35, 3.45 + Math.sin(t * 1.7) * 0.06, 1.05);
    weld.set(Math.sin(t * 5.2) * 0.3, LID_Y + 0.72 + Math.sin(t * 11) * 0.03, -ARM_Z + Math.cos(t * 5.2) * 0.24);
    armTarget.current.copy(idle).lerp(weld, work);
    armSpin.current = 0.8 + work * 9;
    armEyes.current = work;
    sparkActive.current = moving ? 0 : smooth(0.12, 0.16, d) * (1 - smooth(0.76, 0.8, d));
    arm.current?.tipWorld(sparkOrigin.current);

    /* REVIEW — scan sweep, then pass */
    const q = clamp01((d - 0.05) / 0.67);
    const scanning = !moving && d > 0.05 && d < 0.72;
    scan.current.sweep = scanning ? -Math.cos(q * Math.PI * 2) : -1;
    scan.current.beam = scanning ? Math.min(smooth(0, 0.08, q), 1 - smooth(0.92, 1, q)) : 0;
    scan.current.pass = !moving && d > 0.74 ? 1 : 0;

    /* DONE — stamp */
    press.current = moving
      ? 0
      : d < 0.08
        ? 0
        : d < 0.2
          ? Math.pow((d - 0.08) / 0.12, 2)
          : d < 0.28
            ? 1
            : 1 - easeInOut(clamp01((d - 0.28) / 0.14));

    /* crates: pool slot j holds crate n = c - k, k = slots travelled */
    movers.current.visible = clock.frame > 2; // keep movers out of the contact-shadow bake
    for (let j = 0; j < POOL; j++) {
      const cr = crates.current[j];
      const blob = blobs.current[j];
      if (!cr) continue;
      const k = (((c - j) % POOL) + POOL) % POOL;
      let x: number = SX[0];
      let y = CRATE_Y;
      let s = 1;
      let rz = 0;
      let sqY = 1;
      let onBelt = true;

      if (k === 0) {
        if (moving) {
          y = THREE.MathUtils.lerp(3.35 - 0.38, CRATE_Y, g * g);
          s = THREE.MathUtils.lerp(0.75, 1, g);
          onBelt = g > 0.7;
        } else if (d < 0.1) {
          sqY = 1 - 0.18 * Math.sin((Math.PI * d) / 0.1);
        }
      } else if (k < 4) {
        x = moving ? SX[k - 1] + SPACING * mv : SX[k];
      } else {
        // leaving: belt → ramp → bin, then sink away
        if (moving) {
          if (mv < 0.55) {
            x = THREE.MathUtils.lerp(SX[3], 9.9, mv / 0.55);
          } else {
            const f = (mv - 0.55) / 0.45;
            x = THREE.MathUtils.lerp(9.9, BIN_X, f);
            y = THREE.MathUtils.lerp(CRATE_Y, 0.62, f * f);
            rz = -0.32 * Math.sin(Math.PI * f);
            onBelt = false;
          }
        } else {
          x = BIN_X;
          const sink = smooth(0.2, 0.55, d);
          y = 0.62 - sink * 0.5;
          s = 1 - sink;
          onBelt = false;
        }
      }

      // stamp impact squash
      if (k === 3 && !moving && d > 0.19 && d < 0.32) sqY = 1 - 0.13 * Math.sin((Math.PI * (d - 0.19)) / 0.13);

      cr.root.position.set(x, y, 0);
      cr.root.rotation.z = rz;
      cr.root.scale.setScalar(Math.max(s, 0.0001));
      cr.root.visible = s > 0.01;
      cr.body.scale.set(1 + (1 - sqY) * 0.5, sqY, 1 + (1 - sqY) * 0.5);

      const band = k === 1 ? (moving ? 0 : clamp01((d - 0.14) / 0.64)) : k >= 2 ? 1 : 0;
      cr.band.scale.x = Math.max(band, 0.0001);
      cr.band.visible = band > 0.001;

      const chk = k === 2 && !moving && d > 0.76 ? backOut(clamp01((d - 0.76) / 0.1)) : k === 3 && moving ? 1 - mv : 0;
      cr.check.scale.setScalar(Math.max(chk, 0.0001));
      cr.check.visible = chk > 0.01;

      cr.decal.visible = (k === 3 && !moving && d >= 0.2) || k === 4;

      const rib = k === 3 ? (moving ? 0 : smooth(0.45, 0.68, d)) : k === 4 ? 1 : 0;
      cr.ribbon.scale.y = Math.max(rib, 0.0001);
      cr.ribbon.visible = rib > 0.001;
      const bow = k === 3 ? (moving ? 0 : backOut(clamp01((d - 0.68) / 0.1))) : k === 4 ? 1 : 0;
      cr.bow.scale.setScalar(Math.max(bow, 0.0001));
      cr.bow.visible = bow > 0.01;

      if (blob) {
        blob.visible = onBelt && cr.root.visible;
        blob.position.x = x;
        const lift = clamp01((y - CRATE_Y) / 1.6);
        blob.scale.set(1.75 * (1 - lift * 0.4) * s, 1.75 * (1 - lift * 0.4) * s, 1);
      }
    }
  }, -5);

  const notesKey = stations.map((s) => s.note).join("|");
  const paint = useCallback(
    (p: FloorPainter) => {
      const { ctx, k, at } = p;
      STATIONS.forEach((kind, i) => {
        const accent = palette[STATION_ACCENT[kind]];
        paintPad(p, SX[i], -0.75, 4.3, 5.6, mixHex(palette.floor, accent, colors.night ? 0.22 : 0.26), accent);
        // printed caption on the front apron
        const [cx, cz] = at(SX[i], 2.95);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = palette.ink;
        ctx.font = `800 ${Math.round(k * 0.42)}px ${colors.fontSans}`;
        ctx.fillText(`${String(i + 1).padStart(2, "0")}  ${stations[i]?.name ?? kind.toUpperCase()}`, cx, cz);
        ctx.fillStyle = palette.ink3;
        ctx.font = `600 ${Math.round(k * 0.27)}px ${colors.fontMono}`;
        ctx.fillText((stations[i]?.note ?? "").toUpperCase(), cx, cz + k * 0.5);
        if (i < 3) {
          const [ax, az] = at(SX[i] + SPACING / 2, 3.12);
          ctx.fillStyle = palette.ink2;
          ctx.font = `700 ${Math.round(k * 0.5)}px ${colors.fontSans}`;
          ctx.fillText("→", ax, az);
        }
      });
      // bin lane
      paintPad(p, BIN_X, -0.1, 3, 3.4, mixHex(palette.floor, palette.green, 0.14), palette.green);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette, colors, notesKey],
  );

  const onColor: Record<StationKind, string> = {
    todo: colors.onCobalt,
    doing: colors.onOrange,
    review: colors.onMustard,
    done: colors.onGreen,
  };

  return (
    <group>
      <DioramaBase width={27.5} depth={10} center={[0.9, -0.5]} paint={paint} paintKey={notesKey} />
      <ContactShadows
        key={`${palette.outline}-${palette.floor}`}
        position={[0.9, 0.012, -0.5]}
        scale={[27, 9.6]}
        resolution={512}
        blur={2.4}
        far={5}
        opacity={colors.night ? 0.7 : 0.38}
        color={colors.night ? "#000000" : palette.ink}
        frames={1}
      />

      <Conveyor from={-10.2} to={9.7} top={BELT_TOP} travelRef={travel} />

      {/* signs */}
      {STATIONS.map((kind, i) => (
        <StationSign
          key={kind}
          position={[SX[i], 0, -3.75]}
          kicker={String(i + 1).padStart(2, "0")}
          text={stations[i]?.name ?? kind.toUpperCase()}
          accent={STATION_ACCENT[kind]}
          on={onColor[kind]}
        />
      ))}

      {/* 01 TODO — intake hopper + backlog pile */}
      <Hopper position={[SX[0], 0, 0]} />
      <group position={[SX[0] - 2.5, 0, -2.1]}>
        <Crate label="CLF-97" position={[0, 0.5, 0]} extras={false} />
        <Crate label="CLF-98" position={[0.25, 1.5, 0.05]} scale={0.86} extras={false} />
        <Crate label="CLF-99" position={[-0.2, 0.42, 1.55]} scale={0.84} extras={false} />
      </group>

      {/* 02 DOING — the agent + its terminal */}
      <Terminal position={[SX[1] + 2.0, 0, -2.45]} rotationY={-0.3} activeRef={armEyes} />

      {/* 03 REVIEW */}
      <Scanner position={[SX[2], 0, 0]} driveRef={scan} targetY={LID_Y} />

      {/* 04 DONE — stamp, ramp, bin */}
      <StampPress position={[SX[3], 0, 0]} pressRef={press} contactY={LID_Y} />
      <Block size={[1.6, 0.08, 1.5]} position={[10.55, 0.66, 0]} rotation-z={-0.2} color="steel" />
      <Bin position={[BIN_X, 0, 0]} />

      {/* movers — excluded from the shadow bake, they get blob shadows */}
      <group ref={movers} visible={false}>
        <RobotArm ref={arm} position={[SX[1], 0, ARM_Z]} targetRef={armTarget} spinRef={armSpin} eyesRef={armEyes} />
        <Sparks originRef={sparkOrigin} activeRef={sparkActive} floorY={LID_Y - 0.05} />
        {LABELS.map((lbl, j) => (
          <Crate
            key={lbl}
            label={lbl}
            ref={(h) => {
              crates.current[j] = h;
            }}
          />
        ))}
        {LABELS.map((lbl, j) => (
          <Blob
            key={`b-${lbl}`}
            size={[1, 1]}
            position={[0, BELT_TOP + 0.012, 0]}
            opacity={0.3}
            ref={(m) => {
              blobs.current[j] = m;
            }}
          />
        ))}
      </group>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Camera: wide establishing shot → scroll dollies down the line, station by
   station; gentle pointer parallax. Pushes the scene down at the top of the
   hero so the headline sits on clean paper.
   ════════════════════════════════════════════════════════════════════════ */

function CameraRig({ driveRef, reducedMotion }: { driveRef: MutableRefObject<FactoryDrive>; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const cur = useRef<{ pos: THREE.Vector3; tgt: THREE.Vector3; init: boolean }>({
    pos: new THREE.Vector3(),
    tgt: new THREE.Vector3(),
    init: false,
  });
  const lastShift = useRef({ w: 0, h: 0, s: NaN });
  const tmp = useMemo(
    () => ({
      dirO: new THREE.Vector3(0.16, 0.6, 1).normalize(),
      dirC: new THREE.Vector3(0.55, 0.5, 1).normalize(),
      tgtO: new THREE.Vector3(),
      tgtC: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      tgt: new THREE.Vector3(),
      offO: new THREE.Vector3(),
      offC: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const d = driveRef.current;
    const aspect = size.width / Math.max(1, size.height);
    const p = reducedMotion ? 0 : d.progress;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

    // establishing: fit the slab's width
    const distO = THREE.MathUtils.clamp(15.8 / (tanH * aspect), 24, 64);
    tmp.tgtO.set(1.2, 0.8, -0.3);
    tmp.offO.copy(tmp.dirO).multiplyScalar(distO);

    // close: travel TODO → DONE
    tmp.tgtC.set(focusX(p), 1.7, -0.4);
    const distC = THREE.MathUtils.clamp(6.2 / (tanH * Math.min(aspect, 1.5)), 13, 30);
    tmp.offC.copy(tmp.dirC).multiplyScalar(distC);

    const b = smooth(0, 0.2, p);
    tmp.tgt.lerpVectors(tmp.tgtO, tmp.tgtC, b);
    tmp.pos.copy(tmp.tgt).add(tmp.offO.lerp(tmp.offC, b));
    if (!reducedMotion) {
      tmp.pos.x += d.px * 1.1;
      tmp.pos.y -= d.py * 0.7;
    }

    const c = cur.current;
    if (!c.init || reducedMotion) {
      c.pos.copy(tmp.pos);
      c.tgt.copy(tmp.tgt);
      c.init = true;
    } else {
      const k = 1 - Math.exp(-Math.min(delta, 0.1) * 4.5);
      c.pos.lerp(tmp.pos, k);
      c.tgt.lerp(tmp.tgt, k);
    }
    camera.position.copy(c.pos);
    camera.lookAt(c.tgt);

    // push the frame down while the headline is on screen
    const shift = Math.round((1 - b) * d.shiftY * size.height);
    const ls = lastShift.current;
    if (ls.s !== shift || ls.w !== size.width || ls.h !== size.height) {
      camera.setViewOffset(size.width, size.height, 0, -shift, size.width, size.height);
      ls.s = shift;
      ls.w = size.width;
      ls.h = size.height;
    }
  });

  return null;
}
