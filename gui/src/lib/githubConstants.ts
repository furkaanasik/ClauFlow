import type { StatusKind } from "@/components/ui/Pills";

type PRState = "OPEN" | "MERGED" | "CLOSED";

/**
 * PR state → Atölye status colour (matches the card PR badge: open cobalt,
 * merged green, closed red). Labels come from i18n (`prs.state.*`).
 */
export const PR_STATE_STYLES: Record<PRState, { status: StatusKind; fill: string; text: string }> = {
  OPEN:   { status: "info",  fill: "var(--cobalt)", text: "var(--cobalt-text)" },
  MERGED: { status: "done",  fill: "var(--green)",  text: "var(--green-text)" },
  CLOSED: { status: "error", fill: "var(--red)",    text: "var(--red-text)" },
};

export function prState(state: string): PRState {
  return state === "MERGED" || state === "CLOSED" ? state : "OPEN";
}
