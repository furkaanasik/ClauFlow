// Source: https://docs.anthropic.com/en/docs/about-claude/models  (per 1M tokens, USD)

export const PRICING_UPDATED_AT = "2026-05-04";

export function isPricingStale(now: Date = new Date()): boolean {
  const updated = new Date(PRICING_UPDATED_AT);
  const diffMs = now.getTime() - updated.getTime();
  return diffMs > 90 * 24 * 60 * 60 * 1000;
}

interface ModelPricing {
  model: string;
  inputPerM: number;
  outputPerM: number;
  cacheCreationPerM: number;
  cacheReadPerM: number;
}

export const MODEL_PRICING: ModelPricing[] = [
  {
    model: "claude-sonnet-4-5",
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheCreationPerM: 3.75,
    cacheReadPerM: 0.3,
  },
  {
    model: "claude-sonnet-4-6",
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheCreationPerM: 3.75,
    cacheReadPerM: 0.3,
  },
  {
    model: "claude-opus-4-5",
    inputPerM: 15.0,
    outputPerM: 75.0,
    cacheCreationPerM: 18.75,
    cacheReadPerM: 1.5,
  },
  {
    model: "claude-opus-4-7",
    inputPerM: 15.0,
    outputPerM: 75.0,
    cacheCreationPerM: 18.75,
    cacheReadPerM: 1.5,
  },
  {
    model: "claude-haiku-4-5",
    inputPerM: 1.0,
    outputPerM: 5.0,
    cacheCreationPerM: 1.25,
    cacheReadPerM: 0.1,
  },
];

export const DEFAULT_MODEL = "claude-sonnet-4-5";
export const DEFAULT_TASK_BUDGET_USD = 2.0;

interface UsageInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const PRICED_FAMILIES = ["haiku", "sonnet", "opus"] as const;
type PricedFamily = (typeof PRICED_FAMILIES)[number];

// Families without a pricing row borrow the most expensive known family so
// budget estimates err on the safe side.
const FAMILY_ALIASES: Record<string, PricedFamily> = { fable: "opus", mythos: "opus" };

function familyOf(model: string): PricedFamily | null {
  const m = model.toLowerCase();
  for (const f of PRICED_FAMILIES) if (m.includes(f)) return f;
  for (const [alias, f] of Object.entries(FAMILY_ALIASES)) if (m.includes(alias)) return f;
  return null;
}

function versionOf(model: string): number[] {
  return (model.match(/\d+/g) ?? []).map(Number);
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Exact model id first, then the newest pricing row of the model's family
 * (`opus`, `claude-opus-5-5` → newest opus row), then DEFAULT_MODEL.
 */
export function resolveModelPricing(model?: string | null): ModelPricing {
  const requested = model ?? DEFAULT_MODEL;
  const exact = MODEL_PRICING.find((m) => m.model === requested);
  if (exact) return exact;
  const family = familyOf(requested);
  if (family) {
    const newest = MODEL_PRICING.filter((m) => familyOf(m.model) === family).sort((a, b) =>
      compareVersions(versionOf(b.model), versionOf(a.model)),
    )[0];
    if (newest) return newest;
  }
  const fallback = MODEL_PRICING.find((m) => m.model === DEFAULT_MODEL);
  if (!fallback) {
    throw new Error(`Default model missing from MODEL_PRICING: ${DEFAULT_MODEL}`);
  }
  return fallback;
}

export function calculateCostUsd(
  usage: UsageInput,
  model?: string | null,
): number {
  const p = resolveModelPricing(model);
  return (
    (usage.inputTokens * p.inputPerM +
      usage.outputTokens * p.outputPerM +
      usage.cacheWriteTokens * p.cacheCreationPerM +
      usage.cacheReadTokens * p.cacheReadPerM) /
    1_000_000
  );
}

export function getActivePricing(): ModelPricing[] {
  return MODEL_PRICING.slice();
}
