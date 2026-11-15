"use client";

import clsx from "clsx";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { STATUS_COLOR } from "@/components/ui/Pills";
import { IconBoard, IconFactory, IconList } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useViewStore } from "@/store/viewStore";
import type { TaskStatus } from "@/types";
import { STATIONS } from "./factoryLayout";

/**
 * Printed (2D) factory line: shown while the 3D scene loads and as the
 * fallback when WebGL2 is unavailable or the renderer fails.
 */
export function FactoryFallback({
  counts,
  note,
  className,
}: {
  counts: Record<TaskStatus, number>;
  /** When set, the print is the fallback: explain why and offer the 2D views. */
  note?: string;
  className?: string;
}) {
  const t = useTranslation();
  const setView = useViewStore((s) => s.setView);

  return (
    <div className={clsx("grid h-full w-full place-items-center p-6", className)}>
      <div className="w-full max-w-4xl">
        <div className="ui-hatch relative rounded-[14px] border-2 border-line bg-sunken px-6 pb-7 pt-9">
          <div className="absolute inset-x-6 top-[4.15rem] h-3 rounded-pill border-2 border-line bg-panel" aria-hidden>
            <div
              className="h-full w-full rounded-pill"
              style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--hair) 0 2px, transparent 2px 16px)" }}
            />
          </div>
          <ol className="relative grid grid-cols-6 gap-3">
            {STATIONS.map((s, i) => (
              <li key={s.status} className="flex flex-col items-center gap-2.5">
                <span
                  className={clsx(
                    "grid h-14 w-14 place-items-center rounded-[12px] border-2 border-line font-mono text-lg font-bold",
                    s.status === "nothing" && "ui-hatch",
                  )}
                  style={
                    {
                      background: s.status === "nothing" ? "var(--panel)" : STATUS_COLOR[s.status].fill,
                      color: s.status === "nothing" ? "var(--ink-2)" : STATUS_COLOR[s.status].on,
                      boxShadow: "3px 3px 0 var(--shadow-ink)",
                    } as CSSProperties
                  }
                >
                  {counts[s.status]}
                </span>
                <span className="text-center text-[12px] font-bold leading-tight text-ink">
                  <span className="mr-1 font-mono text-[10px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  {t.board.columns[s.status]}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {note && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="ui-panel__icon" aria-hidden>
              <IconFactory size={16} />
            </span>
            <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-ink-2">{note}</p>
            <Button size="sm" variant="primary" icon={<IconBoard size={14} />} onClick={() => setView("board")}>
              {t.board.factory.toBoard}
            </Button>
            <Button size="sm" variant="secondary" icon={<IconList size={14} />} onClick={() => setView("list")}>
              {t.board.factory.toList}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
