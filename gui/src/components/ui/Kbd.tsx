import clsx from "clsx";
import type { ReactNode } from "react";

/** Keycap: 1.5px rule with a 3px base, mono glyph. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={clsx("ui-kbd", className)}>{children}</kbd>;
}
