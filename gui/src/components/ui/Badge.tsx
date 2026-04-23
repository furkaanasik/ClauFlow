import clsx from "clsx";
import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "yellow"
  | "orange"
  | "purple"
  | "green"
  | "red";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-zinc-800 text-zinc-200 ring-zinc-700",
  blue: "bg-blue-900/60 text-blue-200 ring-blue-700",
  yellow: "bg-yellow-900/60 text-yellow-200 ring-yellow-700",
  orange: "bg-orange-900/60 text-orange-200 ring-orange-700",
  purple: "bg-purple-900/60 text-purple-200 ring-purple-700",
  green: "bg-emerald-900/60 text-emerald-200 ring-emerald-700",
  red: "bg-red-900/60 text-red-200 ring-red-700",
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  pulse?: boolean;
}

export function Badge({
  tone = "neutral",
  children,
  className,
  pulse = false,
}: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        pulse && "animate-pulse",
        className,
      )}
    >
      {children}
    </span>
  );
}
