"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Kbd } from "./Kbd";

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut shown as a keycap after the text. */
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  /** Hover delay in ms (focus shows immediately). */
  delay?: number;
  /** A single focusable element (button, link). */
  children: ReactElement<{ "aria-describedby"?: string }>;
}

/**
 * Ink tooltip with a mustard offset shadow. Shows on hover (after `delay`)
 * and on keyboard focus; Esc hides it. Wires `aria-describedby` on the child.
 */
export function Tooltip({ content, shortcut, side = "top", delay = 300, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (immediate = false) => {
    clear();
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => clear, []);

  const trigger = isValidElement(children)
    ? cloneElement(children, { "aria-describedby": open ? id : undefined })
    : children;

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => show()}
      onPointerLeave={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(":focus-visible")) show(true);
      }}
      onBlur={hide}
    >
      {trigger}
      {open && (
        <span role="tooltip" id={id} className={`ui-tooltip ui-tooltip--${side}`}>
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </span>
      )}
    </span>
  );
}
