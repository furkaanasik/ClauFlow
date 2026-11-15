/**
 * Display formatters shared by the board, drawers, insights and toasts.
 */

/** USD amount: "$0.38", "<$0.01", "$120". `precision` sets the decimals (insights uses 3). */
export function formatUsd(n: number, opts: { precision?: number } = {}): string {
  const precision = opts.precision ?? 2;
  const min = 10 ** -precision;
  if (n > 0 && n < min) return "<$" + min.toFixed(precision);
  return "$" + n.toFixed(n >= 100 ? 0 : precision);
}

/** Token count: 1234 → "1.2K", 1234567 → "1.2M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Duration in milliseconds.
 * - `short` (default): "850ms", "4.2s", "1m 13s"
 * - `clock`: "MM:SS" (elapsed timers)
 * Missing values render as `empty` ("" by default).
 */
export function formatDuration(
  ms: number | null | undefined,
  opts: { style?: "short" | "clock"; empty?: string } = {},
): string {
  if (ms == null) return opts.empty ?? "";
  if (opts.style === "clock") {
    const total = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}
