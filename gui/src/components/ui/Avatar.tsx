import clsx from "clsx";
import type { CSSProperties } from "react";
import { IconRobot } from "./icons";

export type AvatarSize = "xs" | "sm" | "md" | "lg";
export type AvatarState = "idle" | "running" | "error" | "online";

const PX: Record<AvatarSize, number> = { xs: 20, sm: 28, md: 36, lg: 48 };

/** Fill + ink pairs that pass contrast in both themes. */
const SWATCHES = [
  { bg: "var(--mustard)", fg: "var(--on-mustard)" },
  { bg: "var(--cobalt)", fg: "var(--on-cobalt)" },
  { bg: "var(--orange)", fg: "var(--on-orange)" },
  { bg: "var(--green)", fg: "var(--on-green)" },
  { bg: "var(--sunken)", fg: "var(--ink)" },
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const STATE_DOT: Record<AvatarState, string | null> = {
  idle: null,
  online: "var(--green)",
  running: "var(--orange)",
  error: "var(--red)",
};

export interface AvatarProps {
  name: string;
  /** `agent` = rounded square with a robot glyph; `user` = circle with initials. */
  kind?: "agent" | "user";
  src?: string;
  size?: AvatarSize;
  state?: AvatarState;
  className?: string;
}

export function Avatar({ name, kind = "user", src, size = "md", state = "idle", className }: AvatarProps) {
  const px = PX[size];
  const sw = kind === "agent" ? SWATCHES[0] : SWATCHES[hash(name) % SWATCHES.length];
  const dot = STATE_DOT[state];
  const style: CSSProperties = {
    width: px,
    height: px,
    background: sw.bg,
    color: sw.fg,
    borderRadius: kind === "agent" ? Math.round(px * 0.28) : 999,
    borderWidth: size === "xs" ? 1.5 : 2,
    fontSize: Math.round(px * 0.38),
  };
  return (
    <span
      role="img"
      aria-label={state === "idle" ? name : `${name} · ${state}`}
      className={clsx("relative inline-grid flex-none place-items-center border-line font-bold leading-none", className)}
      style={style}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are external GitHub URLs
        <img src={src} alt="" className="h-full w-full object-cover" style={{ borderRadius: "inherit" }} />
      ) : kind === "agent" ? (
        <IconRobot size={Math.round(px * 0.55)} />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      {dot && (
        <span
          aria-hidden
          className={clsx("ui-dot absolute", state === "running" && "ui-dot--live")}
          style={
            {
              "--dot": dot,
              right: -3,
              bottom: -3,
              width: Math.max(8, px * 0.3),
              height: Math.max(8, px * 0.3),
              borderColor: "var(--line)",
              boxShadow: "0 0 0 2px var(--panel)",
            } as CSSProperties
          }
        />
      )}
    </span>
  );
}
