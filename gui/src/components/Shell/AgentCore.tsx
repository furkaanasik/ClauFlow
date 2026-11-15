"use client";

import clsx from "clsx";
import { useEffect, useRef, type CSSProperties } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { usePrefersReducedMotion } from "@/components/three/activity";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { isAgentWorking } from "@/lib/boardView";

/*
 * Top-bar "agent core" (spec §6, ~36px): a toon cube in an orbit ring. It
 * spins faster, glows orange and gains orbiting sparks with every running
 * agent; with none it breathes slowly.
 *
 * Built with CSS 3D transforms + the Web Animations API instead of a second
 * WebGL canvas: no three.js on every app page, no extra GL context, and the
 * spin runs on the compositor. Speed changes go through updatePlaybackRate(),
 * so the cube accelerates smoothly instead of jumping phase.
 */

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

export function AgentCore() {
  const t = useTranslation();
  const running = useBoardStore((s) => {
    let n = 0;
    for (const id in s.tasks) if (isAgentWorking(s.tasks[id])) n++;
    return n;
  });
  const reduced = usePrefersReducedMotion();
  const spin = useRef<HTMLSpanElement>(null);
  const orbit = useRef<HTMLSpanElement>(null);
  const anims = useRef<Animation[]>([]);

  useEffect(() => {
    if (reduced || !spin.current || !orbit.current || typeof spin.current.animate !== "function") return;
    const a = spin.current.animate(
      [{ transform: "rotateX(-26deg) rotateY(0deg)" }, { transform: "rotateX(-26deg) rotateY(360deg)" }],
      { duration: 5200, iterations: Infinity },
    );
    const b = orbit.current.animate(
      [{ transform: "rotateX(70deg) rotateZ(0deg)" }, { transform: "rotateX(70deg) rotateZ(360deg)" }],
      { duration: 2600, iterations: Infinity },
    );
    anims.current = [a, b];
    return () => {
      a.cancel();
      b.cancel();
      anims.current = [];
    };
  }, [reduced]);

  useEffect(() => {
    const [a, b] = anims.current;
    if (!a || !b) return;
    const rate = running === 0 ? 0.32 : Math.min(4, 1 + running * 0.75);
    a.updatePlaybackRate(rate);
    b.updatePlaybackRate(running === 0 ? 0.25 : rate * 0.8);
  }, [running, reduced]);

  const label =
    running === 0 ? t.shell.core.idle : running === 1 ? t.shell.core.runningOne : t.shell.core.running.replace("{n}", String(running));
  const sparks = Math.min(running, 4);

  return (
    <Tooltip content={label} side="bottom">
      <span
        role="img"
        tabIndex={0}
        aria-label={label}
        className="agent-core ui-focus"
        data-state={running > 0 ? "run" : "idle"}
        style={{ "--core-heat": Math.min(1, 0.45 + running * 0.2) } as CSSProperties}
      >
        <span aria-hidden className="agent-core__halo" />
        <span aria-hidden className="agent-core__stage">
          <span ref={spin} className="agent-core__cube" style={reduced ? { transform: "rotateX(-26deg) rotateY(38deg)" } : undefined}>
            {FACES.map((f) => (
              <span key={f} className={clsx("agent-core__face", `agent-core__face--${f}`)} />
            ))}
          </span>
          <span ref={orbit} className="agent-core__orbit" style={reduced ? { transform: "rotateX(70deg)" } : undefined}>
            {Array.from({ length: sparks }, (_, i) => (
              <span
                key={i}
                className="agent-core__spark"
                style={{ transform: `rotate(${(360 / sparks) * i}deg) translateX(15.5px)` }}
              />
            ))}
          </span>
        </span>
        {running > 0 && <span aria-hidden className="agent-core__count">{running}</span>}
      </span>
    </Tooltip>
  );
}
