"use client";

import clsx from "clsx";
import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { IconButton } from "./Button";
import { IconClose } from "./icons";
import { useEscapeLayer, useFocusTrap, usePresence } from "./overlay";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Small line above the title (task key, breadcrumb). */
  eyebrow?: ReactNode;
  /** Buttons in the header, before the close button. */
  headerActions?: ReactNode;
  /** Slot directly under the header — typically <Tabs>. */
  tabs?: ReactNode;
  /** Right-hand column of the split layout (meta, budget, links). */
  aside?: ReactNode;
  footer?: ReactNode;
  /** md ≈ 40vw, lg ≈ 55vw (task detail), xl ≈ 72vw, full ≈ 94vw (Studio, diff). */
  width?: "md" | "lg" | "xl" | "full";
  children: ReactNode;
  /** Accessible name when `title` isn't plain text. */
  ariaLabel?: string;
  /** Row under the title (status pills, priority, cost). */
  meta?: ReactNode;
  /** Extra classes for the scrolling body (e.g. drop padding for a full-bleed tab). */
  bodyClassName?: string;
  /** Re-keys the body so its enter animation replays (e.g. the active tab). */
  bodyKey?: string;
}

const WIDTH = {
  md: "w-[min(560px,100vw)] md:w-[40vw] md:min-w-[480px]",
  lg: "w-[min(720px,100vw)] md:w-[55vw] md:min-w-[620px]",
  xl: "w-full md:w-[72vw] md:min-w-[760px]",
  full: "w-full md:w-[94vw] md:min-w-[760px]",
} as const;

/**
 * Right-side sheet. The board stays visible behind a light scrim; Esc or a
 * click on the scrim closes it. Optional split layout via `aside`.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  headerActions,
  tabs,
  aside,
  footer,
  width = "lg",
  children,
  ariaLabel,
  meta,
  bodyClassName,
  bodyKey,
}: DrawerProps) {
  const t = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, 180);
  useFocusTrap(panelRef, open && mounted);

  useEscapeLayer(open, onClose);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div className="ui-scrim" data-state={state} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title && !ariaLabel ? titleId : undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
        data-state={state}
        className={clsx(
          "ui-drawer absolute inset-y-0 right-0 flex max-w-full flex-col border-l-2 border-line bg-paper outline-none transition-[width] duration-300 ease-out",
          WIDTH[width],
        )}
      >
        <div className="flex items-start gap-3 border-b-2 border-line bg-panel px-5 pb-4 pt-4">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="mb-1.5 flex items-center gap-2 font-mono text-xs text-ink-3">{eyebrow}</div>}
            {title && (
              <h2 id={titleId} className="t-display text-[22px] leading-tight text-ink">
                {title}
              </h2>
            )}
            {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <IconButton label={t.common.close} size="sm" onClick={onClose}>
              <IconClose size={14} />
            </IconButton>
          </div>
        </div>
        {tabs && <div className="bg-panel pt-2">{tabs}</div>}
        <div className="flex min-h-0 flex-1">
          <div
            key={bodyKey}
            className={clsx("min-w-0 flex-1 overflow-y-auto", bodyClassName ?? "px-5 py-5", bodyKey && "ui-tabpanel")}
          >
            {children}
          </div>
          {aside && (
            <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l-2 border-line bg-panel px-4 py-5 lg:block">
              {aside}
            </aside>
          )}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t-2 border-line bg-panel px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
