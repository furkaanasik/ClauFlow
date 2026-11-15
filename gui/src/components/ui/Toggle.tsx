import clsx from "clsx";
import type { ComponentPropsWithRef, ReactNode } from "react";

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /** Visible label. When omitted, pass `aria-label`. */
  label?: ReactNode;
  /** Small second line under the label. */
  hint?: ReactNode;
}

/** Ruled square checkbox; checked = mustard plate with an ink tick. */
export function Checkbox({ label, hint, className, disabled, ...rest }: CheckboxProps) {
  const box = <input type="checkbox" className={clsx("ui-check", !label && className)} disabled={disabled} {...rest} />;
  if (!label) return box;
  return (
    <label
      className={clsx(
        "inline-flex items-start gap-2.5 text-[13px] text-ink",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        className,
      )}
    >
      <span className="pt-[1px]">{box}</span>
      <span className="flex min-w-0 flex-col">
        <span className="font-medium leading-snug">{label}</span>
        {hint && <span className="text-xs leading-snug text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

export interface SwitchProps extends Omit<ComponentPropsWithRef<"button">, "onChange" | "children"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Accessible name. */
  label: string;
}

/** On/off switch. On = green track; the knob slides with a press ease. */
export function Switch({ checked, onCheckedChange, label, className, type = "button", ...rest }: SwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onCheckedChange(!checked)}
      className={clsx("ui-switch", className)}
      {...rest}
    />
  );
}
