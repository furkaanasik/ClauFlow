import type { TaskUsage } from "@/types";

// Sonnet 4.5 pricing (per 1M tokens)
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;
const PRICE_CACHE_CREATION_PER_M = 3.75;
const PRICE_CACHE_READ_PER_M = 0.3;

/**
 * Calculate approximate cost in USD from token usage.
 */
export function calculateCost(usage: TaskUsage): number {
  const { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens } = usage;
  return (
    (inputTokens * PRICE_INPUT_PER_M +
      outputTokens * PRICE_OUTPUT_PER_M +
      cacheWriteTokens * PRICE_CACHE_CREATION_PER_M +
      cacheReadTokens * PRICE_CACHE_READ_PER_M) /
    1_000_000
  );
}

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
