import clsx from "clsx";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { IconChevronDown } from "./icons";

type Size = "sm" | "md";

export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  size?: Size;
  /** Leading glyph (search, link …). */
  icon?: ReactNode;
  invalid?: boolean;
}

/** Sunken text field with a 2px rule; lifts to panel colour on focus. */
export function Input({ size = "md", icon, invalid, className, ...rest }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={clsx("ui-input", `ui-input--${size}`, icon && "ui-input--has-icon", className)}
      {...rest}
    />
  );
  if (!icon) return input;
  return (
    <span className="ui-field-wrap">
      <span className="ui-field-icon" aria-hidden>{icon}</span>
      {input}
    </span>
  );
}

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
  /** Monospace (logs, prompts, code). */
  mono?: boolean;
}

export function Textarea({ invalid, mono, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={clsx("ui-input", mono && "font-mono text-[13px]", className)}
      {...rest}
    />
  );
}

export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "size"> {
  size?: Size;
  invalid?: boolean;
}

/** Native select (keeps keyboard + mobile behaviour) with an ink chevron. */
export function Select({ size = "md", invalid, className, children, ...rest }: SelectProps) {
  return (
    <span className={clsx("ui-field-wrap", className)}>
      <select
        aria-invalid={invalid || undefined}
        className={clsx("ui-input ui-input--select", `ui-input--${size}`)}
        {...rest}
      >
        {children}
      </select>
      <span className="ui-field-chevron" aria-hidden>
        <IconChevronDown size={14} />
      </span>
    </span>
  );
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Render prop gets the generated id + describedby to wire the control. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
  /** Right-aligned extra in the label row (counter, "optional"). */
  aside?: ReactNode;
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, children, className, aside }: FieldProps) {
  const id = useId();
  const noteId = hint || error ? `${id}-note` : undefined;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        {aside && <span className="font-mono text-[11px] text-ink-3">{aside}</span>}
      </div>
      {children({ id, describedBy: noteId, invalid: !!error })}
      {(error || hint) && (
        <p id={noteId} className={clsx("text-xs", error ? "font-medium text-[var(--red-text)]" : "text-ink-3")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
