import type { RoleKind, Task, TaskStatus } from "@/types";
import { isAgentWorking } from "@/lib/boardView";
import { teamStepKind } from "@/components/Team/roleMeta";

/*
 * Factory view layout: which board column becomes which station, where each
 * task's crate sits and what state it shows. Pure data, no three.js — the DOM
 * wrapper (legend, tooltip, fallback) and the scene share it.
 *
 * World axes: the belt runs along +x at z = 0, crate yards sit in front of it
 * (+z, towards the camera), machines and signs behind it (−z).
 */

export type StationAccent = "ink3" | "orange" | "mustard" | "green";

export interface StationDef {
  status: TaskStatus;
  /** Station centre on the belt. */
  x: number;
  /** Yard grid: columns along x, rows along z, stacked layers. */
  cols: number;
  rows: number;
  layers: number;
  /** z of the first yard row. */
  yardZ: number;
  /** Has a work spot on the belt (the crate the machine is handling). */
  beltSpot: boolean;
  /** Floor pad footprint (x width, z from..to). */
  padW: number;
  padZ: [number, number];
  accent: StationAccent;
}

/** Crate scale relative to the shared kit crate (1.3 × 1 × 1.3). */
export const CRATE_SCALE = 0.74;
export const CRATE_W = 1.3 * CRATE_SCALE;
export const CRATE_H = 1 * CRATE_SCALE;
export const SLOT_PITCH = 1.12;
export const BELT_TOP = 0.86;
export const BELT_FROM = -15.1;
export const BELT_TO = 13.2;

/** Four stations, evenly spaced (7.4) between the todo and done ends of the belt. */
export const STATIONS: readonly StationDef[] = [
  { status: "todo", x: -12, cols: 3, rows: 2, layers: 2, yardZ: 1.8, beltSpot: false, padW: 5.0, padZ: [-3.1, 3.5], accent: "ink3" },
  { status: "doing", x: -4.6, cols: 3, rows: 2, layers: 2, yardZ: 1.8, beltSpot: true, padW: 5.0, padZ: [-3.1, 3.5], accent: "orange" },
  { status: "review", x: 2.8, cols: 3, rows: 2, layers: 2, yardZ: 1.8, beltSpot: true, padW: 5.0, padZ: [-3.1, 3.5], accent: "mustard" },
  { status: "done", x: 10.2, cols: 3, rows: 2, layers: 2, yardZ: 1.8, beltSpot: true, padW: 5.0, padZ: [-3.1, 3.5], accent: "green" },
];

export const STATION_BY_STATUS = Object.fromEntries(STATIONS.map((s) => [s.status, s])) as Record<TaskStatus, StationDef>;

/** Slab bounds (x from..to, z from..to) — the camera keeps its target inside. */
export const SLAB = { x: [-15.8, 15.8] as [number, number], z: [-4.6, 4.7] as [number, number] };

export type Vec3 = [number, number, number];

export interface CrateSpec {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  /** Rest position (crate centre). */
  pos: Vec3;
  onBelt: boolean;
  working: boolean;
  queued: boolean;
  error: boolean;
  smoke: boolean;
  /** Agent step shown above a working crate. */
  step: Task["agent"]["status"];
  /** Team role running on this crate (`agent.currentStep = "team:<kind>"`), else null. */
  role: RoleKind | null;
}

export interface PileSpec {
  status: TaskStatus;
  count: number;
  pos: Vec3;
}

export interface FactoryLayout {
  crates: CrateSpec[];
  piles: PileSpec[];
  counts: Record<TaskStatus, number>;
  /** Machine drives. */
  doingActive: boolean;
  /** Role of the lead working DOING crate (the one on the belt), shown on the station sign. */
  doingRole: RoleKind | null;
  anyError: boolean;
  reviewWaiting: boolean;
  running: number;
}

export function stationCapacity(s: StationDef): number {
  return s.cols * s.rows * s.layers;
}

/** Rest position of yard slot `i` (fills the row nearest the belt first, then stacks). */
export function slotPosition(s: StationDef, i: number): Vec3 {
  const perLayer = s.cols * s.rows;
  const layer = Math.floor(i / perLayer);
  const inLayer = i % perLayer;
  const row = Math.floor(inLayer / s.cols);
  const col = inLayer % s.cols;
  const x = s.x + (col - (s.cols - 1) / 2) * SLOT_PITCH;
  const z = s.yardZ + row * SLOT_PITCH;
  // tiny per-slot jitter in yaw is applied by the crate itself; keep positions on grid
  const y = CRATE_H / 2 + layer * (CRATE_H + 0.015);
  return [x, y, z];
}

export function beltPosition(s: StationDef): Vec3 {
  return [s.x, BELT_TOP + CRATE_H / 2, 0];
}

/** Belt-side entry point for a station (crates ride the belt between stations). */
export function beltX(status: TaskStatus): number {
  const s = STATION_BY_STATUS[status];
  return Math.min(Math.max(s.x, BELT_FROM + 0.6), BELT_TO - 0.4);
}

function rank(t: Task, budget: Record<string, unknown>): number {
  if (isAgentWorking(t)) return 0;
  if (t.agent?.status === "error") return 1;
  if (budget[t.id]) return 2;
  return 3;
}

export function taskKey(t: Task): string {
  return t.displayId ?? `#${t.id.slice(0, 7)}`;
}

/**
 * Assign every visible task to a crate slot. Stations show at most their yard
 * capacity (+ the belt spot); the rest collapse into a "+N" pile that takes
 * the last slot. Working / failing / over-budget crates and the most recently
 * updated ones are kept visible, so a crate that just moved never disappears.
 */
export function buildLayout(tasks: Task[], budgetExceeded: Record<string, unknown>): FactoryLayout {
  const groups: Record<TaskStatus, Task[]> = { todo: [], doing: [], review: [], done: [] };
  for (const t of tasks) groups[t.status]?.push(t);

  const crates: CrateSpec[] = [];
  const piles: PileSpec[] = [];
  const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, review: 0, done: 0 };
  let running = 0;
  let anyError = false;
  let doingActive = false;
  let doingRole: RoleKind | null = null;

  for (const s of STATIONS) {
    const list = [...groups[s.status]].sort((a, b) => {
      const r = rank(a, budgetExceeded) - rank(b, budgetExceeded);
      if (r !== 0) return r;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
    counts[s.status] = list.length;

    const cap = stationCapacity(s) + (s.beltSpot ? 1 : 0);
    const overflow = list.length > cap;
    const shown = overflow ? list.slice(0, cap - 1) : list;

    let yard = 0;
    shown.forEach((t, i) => {
      const working = isAgentWorking(t);
      const error = t.agent?.status === "error";
      if (working) running += 1;
      if (error) anyError = true;
      const role = working && t.agent?.status === "running" ? teamStepKind(t.agent.currentStep) : null;
      if (working && s.status === "doing") doingActive = true;
      if (role && s.status === "doing" && !doingRole) doingRole = role;
      const onBelt = s.beltSpot && i === 0;
      const pos = onBelt ? beltPosition(s) : slotPosition(s, yard++);
      crates.push({
        id: t.id,
        key: taskKey(t),
        title: t.title,
        status: s.status,
        pos,
        onBelt,
        working,
        queued: t.status === "doing" && t.agent?.status === "idle",
        error,
        smoke: Boolean(budgetExceeded[t.id]),
        step: t.agent?.status ?? "idle",
        role,
      });
    });

    if (overflow) {
      // count the hidden ones for running/error too, so the machines stay honest
      for (const t of list.slice(cap - 1)) {
        if (isAgentWorking(t)) running += 1;
        if (t.agent?.status === "error") anyError = true;
      }
      piles.push({ status: s.status, count: list.length - shown.length, pos: slotPosition(s, yard) });
    }
  }

  return {
    crates,
    piles,
    counts,
    doingActive,
    doingRole,
    anyError,
    reviewWaiting: counts.review > 0,
    running,
  };
}

function sameSpec(a: CrateSpec, b: CrateSpec): boolean {
  return (
    a.id === b.id &&
    a.key === b.key &&
    a.title === b.title &&
    a.status === b.status &&
    a.pos[0] === b.pos[0] &&
    a.pos[1] === b.pos[1] &&
    a.pos[2] === b.pos[2] &&
    a.onBelt === b.onBelt &&
    a.working === b.working &&
    a.queued === b.queued &&
    a.error === b.error &&
    a.smoke === b.smoke &&
    a.step === b.step &&
    a.role === b.role
  );
}

/**
 * Reuse unchanged crate specs from the previous layout so memoised crates
 * skip re-rendering (agent log lines update the task map many times a second).
 */
export function stabilizeLayout(prev: FactoryLayout | null, next: FactoryLayout): FactoryLayout {
  if (!prev) return next;
  const old = new Map(prev.crates.map((c) => [c.id, c]));
  let changed = prev.crates.length !== next.crates.length;
  const crates = next.crates.map((c, i) => {
    const o = old.get(c.id);
    const keep = o && sameSpec(o, c) ? o : c;
    if (keep !== prev.crates[i]) changed = true;
    return keep;
  });
  const pilesSame =
    prev.piles.length === next.piles.length &&
    prev.piles.every((p, i) => p.status === next.piles[i].status && p.count === next.piles[i].count);
  const countsSame = (Object.keys(next.counts) as TaskStatus[]).every((k) => prev.counts[k] === next.counts[k]);
  if (
    !changed &&
    pilesSame &&
    countsSame &&
    prev.doingActive === next.doingActive &&
    prev.doingRole === next.doingRole &&
    prev.anyError === next.anyError &&
    prev.reviewWaiting === next.reviewWaiting &&
    prev.running === next.running
  ) {
    return prev;
  }
  return { ...next, crates, piles: pilesSame ? prev.piles : next.piles };
}
