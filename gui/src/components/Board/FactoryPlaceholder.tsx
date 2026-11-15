"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { SectionPill, STATUS_COLOR } from "@/components/ui/Pills";
import { IconBoard, IconFactory, IconList } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useViewStore } from "@/store/viewStore";
import type { TaskStatus } from "@/types";

const STATIONS: TaskStatus[] = ["todo", "doing", "review", "done"];

/** Placeholder for the 3D factory view — a flat, printed preview of the line. */
export function FactoryPlaceholder({ counts }: { counts: Record<TaskStatus, number> }) {
  const t = useTranslation();
  const setView = useViewStore((s) => s.setView);

  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6">
      <div className="ui-panel ui-panel--raised w-full max-w-3xl overflow-hidden">
        {/* printed conveyor preview */}
        <div className="ui-hatch relative border-b-2 border-line bg-sunken px-8 pb-8 pt-10">
          <div className="absolute inset-x-8 top-[4.4rem] h-3 rounded-pill border-2 border-line bg-panel" aria-hidden>
            <div
              className="h-full w-full rounded-pill"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, var(--hair) 0 2px, transparent 2px 16px)",
              }}
            />
          </div>
          <ol className="relative grid grid-cols-4 gap-4">
            {STATIONS.map((s) => (
              <li key={s} className="flex flex-col items-center gap-3">
                <span
                  className="grid h-14 w-14 place-items-center rounded-[12px] border-2 border-line font-mono text-lg font-bold"
                  style={
                    {
                      background: STATUS_COLOR[s].fill,
                      color: STATUS_COLOR[s].on,
                      boxShadow: "3px 3px 0 var(--shadow-ink)",
                    } as CSSProperties
                  }
                >
                  {counts[s]}
                </span>
                <span className="text-[13px] font-bold text-ink">{t.board.columns[s]}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col items-start gap-3 p-6">
          <div className="flex items-center gap-3">
            <span className="ui-panel__icon" aria-hidden>
              <IconFactory size={16} />
            </span>
            <SectionPill tone="ink" size="sm">{t.board.factory.badge}</SectionPill>
          </div>
          <h2 className="t-h1">{t.board.factory.title}</h2>
          <p className="max-w-xl text-[14px] leading-relaxed text-ink-2">{t.board.factory.body}</p>
          <div className="mt-2 flex gap-3">
            <Button variant="primary" icon={<IconBoard size={16} />} onClick={() => setView("board")}>
              {t.board.factory.toBoard}
            </Button>
            <Button variant="secondary" icon={<IconList size={16} />} onClick={() => setView("list")}>
              {t.board.factory.toList}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
