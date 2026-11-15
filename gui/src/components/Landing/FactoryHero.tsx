"use client";

import dynamic from "next/dynamic";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { frameloopFor, useSceneActivity } from "@/components/three/activity";
import { useWebGLSupport } from "@/components/three/webgl";
import { useTranslation } from "@/hooks/useTranslation";
import { FactoryFallback } from "./FactoryFallback";
import { STATION_KINDS, focusedStation } from "./factoryLine";
import type { FactoryDrive } from "./FactoryScene";

// three.js + the scene load only on the client, after hydration
const FactoryScene = dynamic(() => import("./FactoryScene"), { ssr: false, loading: () => null });

const ACCENT = {
  todo: "var(--cobalt)",
  doing: "var(--orange)",
  review: "var(--mustard)",
  done: "var(--green)",
} as const;

/**
 * Sticky, scroll-driven hero: the copy sits on paper at the top, the 3D line
 * fills the stage below; scrolling dollies the camera station by station and
 * the HUD names the station in focus. Under reduced motion the section is a
 * normal-height block with a still frame and a static legend.
 */
export function FactoryHero({ children }: { children: ReactNode }) {
  const t = useTranslation();
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drive = useRef<FactoryDrive>({ progress: 0, px: 0, py: 0, shiftY: 0.2 });
  const activity = useSceneActivity(stage);
  const webgl = useWebGLSupport();
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState(-1);
  const reduced = activity.reducedMotion;

  // scroll progress → drive + CSS var (no React re-render per frame)
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = section.current;
      const st = stage.current;
      if (!el || !st) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total > 1 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      drive.current.progress = p;
      drive.current.shiftY = window.innerWidth < 768 ? 0.3 : window.innerWidth < 1024 ? 0.26 : 0.21;
      st.style.setProperty("--hero-p", p.toFixed(4));
      const f = focusedStation(p);
      setFocus((prev) => (prev === f ? prev : f));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // gentle pointer parallax
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      drive.current.px = (e.clientX / window.innerWidth) * 2 - 1;
      drive.current.py = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  const stations = useMemo(
    () => STATION_KINDS.map((k) => ({ name: t.landing.stations[k].name, note: t.landing.stations[k].note })),
    [t],
  );
  const onReady = useCallback(() => setReady(true), []);

  const fallback = (
    <div className="absolute inset-x-0 bottom-[7%] top-[40%] grid place-items-center px-6">
      <FactoryFallback label={t.landing.sceneLabel} note={t.landing.fallbackNote} className="w-full max-w-5xl" />
    </div>
  );

  return (
    <section
      ref={section}
      aria-label={t.landing.sceneLabel}
      className="relative h-[260vh] motion-reduce:h-auto"
    >
      <div
        ref={stage}
        className="sticky top-0 h-[100svh] min-h-[640px] overflow-hidden motion-reduce:relative motion-reduce:h-[92svh]"
        style={{ ["--hero-p" as string]: 0 }}
      >
        {/* scene */}
        <div className="absolute inset-0">
          {webgl === false ? (
            fallback
          ) : (
            <>
              <div
                aria-hidden
                className={clsx("transition-opacity duration-700", ready ? "pointer-events-none opacity-0" : "opacity-100")}
              >
                <div className="absolute inset-x-0 bottom-[7%] top-[40%] grid place-items-center px-6">
                  <FactoryFallback label="" className="w-full max-w-5xl opacity-60" />
                </div>
              </div>
              {webgl && (
                <div className={clsx("absolute inset-0 transition-opacity duration-700", ready ? "opacity-100" : "opacity-0")}>
                  <FactoryScene
                    driveRef={drive}
                    frameloop={frameloopFor(activity)}
                    reducedMotion={reduced}
                    fallback={fallback}
                    label={t.landing.sceneLabel}
                    stations={stations}
                    onReady={onReady}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* copy — fades and lifts as the dolly starts */}
        <div
          className="pointer-events-none relative z-10 mx-auto max-w-7xl px-6 pt-24 md:px-12 md:pt-28"
          style={{
            opacity: "calc(1 - min(1, max(0, (var(--hero-p) - 0.05) * 7)))",
            transform: "translateY(calc(var(--hero-p) * -160px))",
          }}
        >
          <div className="pointer-events-auto">{children}</div>
        </div>

        {/* station HUD */}
        <StationHud focus={focus} reduced={reduced} />
      </div>
    </section>
  );
}

function StationHud({ focus, reduced }: { focus: number; reduced: boolean }) {
  const t = useTranslation();
  const active = reduced ? -1 : focus;
  const kind = active >= 0 ? STATION_KINDS[active] : null;
  // at the top of the hero the floor print already names every station:
  // show only a scroll cue until the dolly starts
  const showRail = reduced || active >= 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-5 md:px-12 md:pb-8">
      <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-3 md:flex-row md:items-end md:justify-between">
        <ol
          aria-label={t.landing.stationsLabel}
          className={clsx(
            "ui-panel ui-panel--raised flex gap-1 p-1.5 transition-[opacity,transform] duration-300",
            showRail ? "pointer-events-auto opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          {STATION_KINDS.map((k, i) => {
            const on = i === active;
            return (
              <li
                key={k}
                aria-current={on ? "step" : undefined}
                className={clsx(
                  "flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 transition-colors duration-300 md:px-3",
                  on ? "bg-mustard text-[var(--on-mustard)]" : "text-ink-2",
                )}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 flex-none rounded-full border-2 border-line"
                  style={{ background: ACCENT[k] }}
                />
                <span className="font-mono text-[11px] font-bold opacity-70">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[13px] font-bold">{t.landing.stations[k].name}</span>
              </li>
            );
          })}
        </ol>

        {kind && (
          <div key={kind} className="ui-panel ui-panel--raised animate-fade-up max-w-md px-4 py-3" aria-live="polite">
            <p className="t-label !text-ink-2">
              {String(active + 1).padStart(2, "0")} · {t.landing.stations[kind].note}
            </p>
            <p className="mt-1 text-[14px] font-semibold leading-snug text-ink">{t.landing.stations[kind].body}</p>
          </div>
        )}

        {!showRail && (
          <p className="ui-pill ui-pill--md absolute bottom-0 left-1/2 -translate-x-1/2 gap-2 border-2 border-line bg-panel font-semibold text-ink-2 shadow-[2px_2px_0_var(--shadow-ink)]">
            <span aria-hidden className="landing-scroll-cue inline-block">↓</span>
            {t.landing.scrollHint}
          </p>
        )}
      </div>
    </div>
  );
}
