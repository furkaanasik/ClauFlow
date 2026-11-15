import type { TaskUsage } from "@/types";

/**
 * Format a token count for display: 1234 → "1.2K", 1234567 → "1.2M"
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Total token count across all categories.
 */
export function totalTokens(usage: TaskUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheWriteTokens +
    usage.cacheReadTokens
  );
}
