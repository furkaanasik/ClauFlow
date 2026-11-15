"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@/components/ui/icons";

type Tone = "error" | "warn" | "ok" | "cmd" | undefined;

/** Cheap line classifier — colours a log the way a terminal would. */
function toneOf(line: string): Tone {
  if (/(^|\W)(error|failed|fatal|✖|exception)(\W|$)/i.test(line) || /^\s*FAIL\b/.test(line)) return "error";
  if (/(^|\W)(warn|warning)(\W|$)/i.test(line)) return "warn";
  if (/^\s*(\$|>|❯|\+ )/.test(line)) return "cmd";
  if (/(✓|✔|success|pushed|merged|completed|created pull request)/i.test(line) || /^\s*PASS\b/.test(line)) return "ok";
  return undefined;
}

interface LogViewerProps {
  lines: string[];
  /** Blinking cursor on the last line — the process is still writing. */
  live?: boolean;
  /** Keep the view pinned to the bottom while new lines arrive. */
  follow?: boolean;
  followLabel?: string;
  emptyLabel?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Sunken monospace log with a sticky line-number gutter and tone colouring.
 * With `follow`, it sticks to the bottom until the user scrolls up, then
 * offers a "Follow" button to re-pin.
 */
export function LogViewer({
  lines,
  live = false,
  follow = false,
  followLabel = "Follow",
  emptyLabel,
  className,
  ariaLabel,
}: LogViewerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!follow || !pinned || !ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, follow, pinned]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || !follow) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const jump = () => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    setPinned(true);
  };

  return (
    <div className={clsx("relative min-h-0", className)}>
      <div
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-label={ariaLabel}
        tabIndex={0}
        className="logpane ui-focus h-full py-2.5"
      >
        {lines.length === 0 ? (
          <div className="px-4 py-3 text-ink-3">{emptyLabel}</div>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className="logpane__line"
              data-tone={toneOf(line)}
              data-live={live && i === lines.length - 1 ? "true" : undefined}
            >
              <span className="logpane__no">{i + 1}</span>
              <span className="logpane__txt">{line || " "}</span>
            </div>
          ))
        )}
      </div>
      {follow && !pinned && (
        <button
          type="button"
          onClick={jump}
          className="ui-btn ui-btn--primary ui-btn--sm ui-focus absolute bottom-3 right-4"
        >
          <IconChevronDown size={14} />
          {followLabel}
        </button>
      )}
    </div>
  );
}
