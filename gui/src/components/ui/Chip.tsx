import clsx from "clsx";
import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react";
import { IconCheck, IconClose } from "./icons";

export interface ChipProps extends Omit<ComponentPropsWithRef<"button">, "onChange"> {
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  /** Colour swatch dot before the label (label colour, priority …). */
  dot?: string;
  icon?: ReactNode;
  count?: number;
}

/**
 * Selectable filter chip. Toggles `aria-pressed`; selected = ink plate with
 * a mustard offset.
 */
export function Chip({
  selected = false,
  onSelectedChange,
  dot,
  icon,
  count,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={clsx("ui-chip ui-focus", className)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onSelectedChange?.(!selected);
      }}
      {...rest}
    >
      {selected ? (
        <IconCheck size={13} />
      ) : dot ? (
        <span aria-hidden className="ui-dot" style={{ "--dot": dot } as CSSProperties} />
      ) : (
        icon
      )}
      {children}
      {count !== undefined && <span className="ui-chip__count">{count}</span>}
    </button>
  );
}

/** Static, removable tag chip (labels on a card, active filters). */
export function Tag({
  children,
  onRemove,
  removeLabel = "Remove",
  dot,
  className,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  dot?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-panel pl-2 text-xs font-medium text-ink",
        onRemove ? "pr-0.5" : "pr-2",
        className,
      )}
    >
      {dot && <span aria-hidden className="ui-dot !h-2 !w-2 !border" style={{ "--dot": dot } as CSSProperties} />}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="ui-focus inline-grid h-[18px] w-[18px] place-items-center rounded-pill text-ink-3 transition hover:bg-ink hover:text-paper"
        >
          <IconClose size={10} />
        </button>
      )}
    </span>
  );
}
