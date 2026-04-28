export const PR_STATE_STYLES: Record<
  string,
  { label: string; ink: string }
> = {
  OPEN:   { label: "open",   ink: "var(--accent-primary)" },
  MERGED: { label: "merged", ink: "var(--status-review)" },
  CLOSED: { label: "closed", ink: "var(--status-error)" },
};
