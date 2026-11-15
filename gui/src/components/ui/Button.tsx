import clsx from "clsx";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { IconSpinner } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Replaced by a spinner while `loading`. */
  icon?: ReactNode;
  /** Trailing icon (chevrons, arrows). */
  iconRight?: ReactNode;
  loading?: boolean;
  /** Full-width. */
  block?: boolean;
}

const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

/**
 * Atölye button: 2px ink rule, hard offset shadow, sinks on press.
 * `primary` is mustard with ink text (10.7:1), `danger` is red text that
 * floods red on hover.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  block = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "ui-btn ui-focus",
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        block && "ui-btn--block",
        className,
      )}
      {...rest}
    >
      {loading ? <IconSpinner size={ICON_PX[size]} /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Accessible name — rendered as aria-label and title. */
  label: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/** Square, ruled button for a single glyph (×, ⋯, ↻). */
export function IconButton({
  label,
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "ui-btn ui-btn--icon ui-focus",
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        className,
      )}
      {...rest}
    >
      {loading ? <IconSpinner size={ICON_PX[size]} /> : children}
    </button>
  );
}
