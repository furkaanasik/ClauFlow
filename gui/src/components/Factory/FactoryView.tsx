"use client";

import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { frameloopFor, useSceneActivity } from "@/components/three/activity";
import { useWebGLSupport } from "@/components/three/webgl";
import { IconButton } from "@/components/ui/Button";
import { StatusPill, STATUS_COLOR } from "@/components/ui/Pills";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconAlert, IconCoin, IconRetry } from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";
import { useViewStore } from "@/store/viewStore";
import { useTranslation } from "@/hooks/useTranslation";
import { formatUsd } from "@/lib/boardView";
import { ROLE_TONE, agentStepLabel, roleIcon } from "@/components/Team/roleMeta";
import type { Task, TaskStatus } from "@/types";
import { FactoryFallback } from "./FactoryFallback";
import { STATIONS, buildLayout, stabilizeLayout, type CrateSpec, type FactoryLayout, type PileSpec } from "./factoryLayout";
import type { FactoryCameraApi } from "./scene/BoardFactoryScene";
import type { HoverTarget } from "./scene/runtime";

// three.js + the scene load only on the client, after hydration
const BoardFactoryScene = dynamic(() => import("./scene/BoardFactoryScene"), { ssr: false, loading: () => null });

const ACCENT_VAR: Record<string, string> = {
  ink3: "var(--ink-3)",
  orange: "var(--orange)",
  cobalt: "var(--cobalt)",
  mustard: "var(--mustard)",
  green: "var(--green)",
  sunken: "var(--panel)",
};

/**
 * Board "Fabrika" view: the live board as a 3D line (spec §6). No drag and
 * drop here; status changes happen on the 2D board and the crates follow.
 */
export function FactoryView({ tasks, epoch }: { tasks: Task[]; epoch: string }) {
  const t = useTranslation();
  const budgetExceeded = useBoardStore((s) => s.budgetExceeded);
  const selectTask = useBoardStore((s) => s.selectTask);
  const setView = useViewStore((s) => s.setView);

  const stage = useRef<HTMLDivElement>(null);
  const tip = useRef<FactoryTooltipApi>(null);
  const camera = useRef<FactoryCameraApi | null>(null);
  const activity = useSceneActivity(stage);
  const webgl = useWebGLSupport();
  const [ready, setReady] = useState(false);

  const prevLayout = useRef<FactoryLayout | null>(null);
  const layout = useMemo(() => {
    const next = stabilizeLayout(prevLayout.current, buildLayout(tasks, budgetExceeded));
    prevLayout.current = next;
    return next;
  }, [tasks, budgetExceeded]);

  const copy = useMemo(
    () => ({
      columns: t.board.columns,
      notes: t.board.factory.notes,
      steps: t.taskCard.agentSteps,
      roles: t.team.roles,
      activity: t.team.activity,
    }),
    [t],
  );

  const onHover = useCallback((target: HoverTarget | null, x?: number, y?: number) => {
    if (!target) tip.current?.hide();
    else tip.current?.show(target, x ?? 0, y ?? 0);
  }, []);
  const onMove = useCallback((x: number, y: number) => tip.current?.move(x, y), []);
  const onOpen = useCallback(
    (id: string) => {
      tip.current?.hide();
      selectTask(id);
    },
    [selectTask],
  );
  const onPile = useCallback(() => {
    tip.current?.hide();
    setView("list");
  }, [setView]);
  const onReady = useCallback(() => setReady(true), []);

  const fallback = <FactoryFallback counts={layout.counts} note={t.board.factory.fallbackNote} />;

  return (
    <div
      ref={stage}
      className="factory-stage relative min-h-[460px] flex-1 overflow-hidden"
      aria-describedby="factory-help"
    >
      {webgl === false ? (
        fallback
      ) : (
        <>
          <div
            aria-hidden
            className={clsx("absolute inset-0 transition-opacity duration-500", ready ? "pointer-events-none opacity-0" : "opacity-100")}
          >
            <FactoryFallback counts={layout.counts} className="opacity-60" />
          </div>
          {webgl && (
            <div className={clsx("absolute inset-0 transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}>
              <BoardFactoryScene
                layout={layout}
                epoch={epoch}
                frameloop={frameloopFor(activity) === "always" ? "demand" : frameloopFor(activity)}
                reducedMotion={activity.reducedMotion}
                fallback={fallback}
                label={t.board.factory.sceneLabel}
                copy={copy}
                cameraRef={camera}
                onHover={onHover}
                onMove={onMove}
                onOpen={onOpen}
                onPile={onPile}
                onReady={onReady}
              />
            </div>
          )}
        </>
      )}

      {webgl !== false && (
        <>
          {/* stations: counts + focus the camera */}
          <nav
            aria-label={t.board.factory.stationsLabel}
            className="pointer-events-auto absolute left-3 top-3 z-20 flex max-w-[calc(100%-5rem)] flex-wrap gap-1 rounded-[12px] border-2 border-line bg-panel p-1 shadow-[3px_3px_0_var(--shadow-ink)]"
          >
            {STATIONS.map((s) => (
              <button
                key={s.status}
                type="button"
                className="factory-chip ui-focus"
                onClick={() => camera.current?.focus(s.status)}
                title={t.board.factory.focusStation.replace("{name}", t.board.columns[s.status])}
              >
                <span
                  aria-hidden
                  className={clsx("h-2.5 w-2.5 flex-none rounded-full border-2 border-line", s.status === "nothing" && "ui-hatch")}
                  style={{ background: ACCENT_VAR[s.accent] }}
                />
                <span className="text-[12px] font-bold">{t.board.columns[s.status]}</span>
                <span className="font-mono text-[11px] font-bold text-ink-3">{layout.counts[s.status]}</span>
                {s.status === "doing" && layout.doingRole && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold"
                    style={{ color: ROLE_TONE[layout.doingRole].text }}
                  >
                    {roleIcon(layout.doingRole, 12)}
                    {t.team.roles[layout.doingRole]}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="absolute right-3 top-3 z-20">
            <Tooltip content={t.board.factory.resetView} side="left">
              <IconButton
                label={t.board.factory.resetView}
                size="sm"
                variant="secondary"
                onClick={() => camera.current?.reset()}
              >
                <IconRetry size={15} />
              </IconButton>
            </Tooltip>
          </div>

          {/* legend + controls */}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex flex-wrap items-end justify-between gap-2">
            <ul aria-label={t.board.factory.legendLabel} className="factory-legend">
              <li>
                <span className="factory-legend__lamp" style={{ "--lamp": "var(--green)" } as CSSProperties} />
                {t.board.factory.legend.running}
              </li>
              <li>
                <span className="factory-legend__lamp" style={{ "--lamp": "var(--mustard)" } as CSSProperties} />
                {t.board.factory.legend.queued}
              </li>
              <li>
                <span className="factory-legend__lamp" style={{ "--lamp": "var(--red)" } as CSSProperties} />
                {t.board.factory.legend.error}
              </li>
              <li>
                <span className="factory-legend__puff" aria-hidden />
                {t.board.factory.legend.budget}
              </li>
            </ul>
            <p id="factory-help" className="factory-legend !gap-x-3 text-ink-3">
              {t.board.factory.controlsHint}
            </p>
          </div>
        </>
      )}

      <FactoryTooltip ref={tip} stage={stage} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Pointer-following tooltip. Imperative so mouse moves never re-render the
   view; content changes only when the hovered crate changes.
   ════════════════════════════════════════════════════════════════════════ */

interface FactoryTooltipApi {
  show: (target: HoverTarget, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
}

const FactoryTooltip = forwardRef<FactoryTooltipApi, { stage: React.RefObject<HTMLDivElement | null> }>(
  function FactoryTooltip({ stage }, ref) {
    const t = useTranslation();
    const el = useRef<HTMLDivElement>(null);
    const [target, setTarget] = useState<HoverTarget | null>(null);
    const task = useBoardStore((s) => (target?.kind === "crate" ? s.tasks[target.spec.id] : undefined));
    const budget = useBoardStore((s) => (target?.kind === "crate" ? s.budgetExceeded[target.spec.id] : undefined));

    const place = useCallback(
      (x: number, y: number) => {
        const box = stage.current?.getBoundingClientRect();
        const node = el.current;
        if (!box || !node) return;
        const w = node.offsetWidth || 260;
        const h = node.offsetHeight || 120;
        let left = x - box.left + 16;
        let top = y - box.top + 18;
        if (left + w > box.width - 8) left = x - box.left - w - 16;
        if (top + h > box.height - 8) top = y - box.top - h - 14;
        node.style.left = `${Math.max(8, left)}px`;
        node.style.top = `${Math.max(8, top)}px`;
      },
      [stage],
    );

    const last = useRef({ x: 0, y: 0 });
    useImperativeHandle(
      ref,
      () => ({
        show: (next, x, y) => {
          last.current = { x, y };
          setTarget(next);
          place(x, y);
        },
        move: (x, y) => {
          last.current = { x, y };
          place(x, y);
        },
        hide: () => setTarget(null),
      }),
      [place],
    );

    // position right after the tooltip mounts / its content changes size
    useLayoutEffect(() => {
      if (target) place(last.current.x, last.current.y);
    }, [target, place]);

    if (!target) return null;

    return (
      <div ref={el} role="tooltip" className="factory-tip">
        {target.kind === "pile" ? (
          <PileTip pile={target.pile} />
        ) : (
          <CrateTip spec={target.spec} task={task} budget={budget} />
        )}
        <p className="factory-tip__hint">
          {target.kind === "pile" ? t.board.factory.tooltip.openList : t.board.factory.tooltip.open}
        </p>
      </div>
    );
  },
);

function CrateTip({
  spec,
  task,
  budget,
}: {
  spec: CrateSpec;
  task?: Task;
  budget?: { spentUsd: number; budgetUsd: number };
}) {
  const t = useTranslation();
  const qaRound = useBoardStore((s) => {
    const runs = s.teamRuns[spec.id];
    return runs?.[runs.length - 1]?.qaRound ?? 0;
  });
  const status = (task?.status ?? spec.status) as TaskStatus;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-bold">{spec.key}</span>
        <span className="flex-1" />
        <StatusPill status={status} size="sm">
          {t.board.columns[status]}
        </StatusPill>
      </div>
      <p className="mt-1.5 text-[13px] font-semibold leading-snug">{task?.title ?? spec.title}</p>
      {(spec.working || spec.queued || spec.error || budget) && (
        <div className="mt-2 flex flex-col gap-1">
          {spec.working && (
            <span className="factory-tip__row" style={{ color: "var(--orange-text)" }}>
              <span className="ui-dot ui-dot--live !h-2 !w-2" style={{ "--dot": "var(--orange)" } as CSSProperties} />
              {task ? agentStepLabel(task.agent, t, qaRound) : t.taskCard.agentSteps[spec.step]}
            </span>
          )}
          {spec.queued && (
            <span className="factory-tip__row" style={{ color: "var(--mustard-text)" }}>
              <span className="ui-dot !h-2 !w-2" style={{ "--dot": "var(--mustard)" } as CSSProperties} />
              {t.taskCard.queued}
            </span>
          )}
          {spec.error && (
            <span className="factory-tip__row" style={{ color: "var(--red-text)" }}>
              <IconAlert size={12} />
              <span className="line-clamp-2">{task?.agent.error || t.board.factory.tooltip.error}</span>
            </span>
          )}
          {budget && (
            <span className="factory-tip__row" style={{ color: "var(--red-text)" }}>
              <IconCoin size={12} />
              {t.board.factory.tooltip.budget
                .replace("{spent}", formatUsd(budget.spentUsd))
                .replace("{limit}", formatUsd(budget.budgetUsd))}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function PileTip({ pile }: { pile: PileSpec }) {
  const t = useTranslation();
  return (
    <>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full border-2 border-line"
          style={{ background: STATUS_COLOR[pile.status].fill }}
        />
        <span className="text-[12px] font-bold">{t.board.columns[pile.status]}</span>
      </div>
      <p className="mt-1.5 text-[13px] font-semibold leading-snug">
        {t.board.factory.tooltip.more.replace("{n}", String(pile.count))}
      </p>
    </>
  );
}
