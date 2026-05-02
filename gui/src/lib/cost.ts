import type { TaskUsage } from "@/types";
import { api } from "./api";

// Sonnet 4.5 fallback prices (per 1M tokens) — used until the server pricing
// table loads, or if the request fails. Identical to the previous hardcoded
// values, so first paint stays correct in offline / pre-load scenarios.
interface PriceRow {
  input: number;
  output: number;
  cw: number;
  cr: number;
}

const FALLBACK: PriceRow = {
  input: 3.0,
  output: 15.0,
  cw: 3.75,
  cr: 0.3,
};

let cache: { defaultModel: string; table: Map<string, PriceRow> } | null = null;
let inflight: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (cache) return;
  if (!inflight) {
    inflight = api
      .getPricing()
      .then((res) => {
        const t = new Map<string, PriceRow>();
        for (const p of res.pricing) {
          t.set(p.model, {
            input: p.inputPerM,
            output: p.outputPerM,
            cw: p.cacheCreationPerM,
            cr: p.cacheReadPerM,
          });
        }
        cache = { defaultModel: res.defaultModel, table: t };
      })
      .catch(() => {
        // Keep fallback. Phase 5 will surface a "pricing unreachable" warning.
      });
  }
  await inflight;
}

// Trigger fetch on module load — sync calculateCost callers benefit from
// having the table cached by the time they render.
void ensureLoaded();

/**
 * Calculate approximate cost in USD from token usage.
 *
 * Optional `model` lets callers compute per-node costs once Phase 2 lands.
 * Unknown / null model falls back to the server's default model, then to the
 * Sonnet 4.5 fallback prices if the server pricing table isn't loaded yet.
 */
export function calculateCost(
  usage: TaskUsage,
  model?: string | null,
): number {
  const key = model ?? cache?.defaultModel ?? null;
  const p = (key ? cache?.table.get(key) : null) ?? FALLBACK;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheWriteTokens * p.cw +
      usage.cacheReadTokens * p.cr) /
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
