// Source: https://docs.anthropic.com/en/docs/about-claude/models  (per 1M tokens, USD)
// Phase 7 will add a staleness warning when this table is older than 90 days.

export interface ModelPricing {
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

export interface UsageInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function calculateCostUsd(
  usage: UsageInput,
  model?: string | null,
): number {
  const requested = model ?? DEFAULT_MODEL;
  const fallback = MODEL_PRICING.find((m) => m.model === DEFAULT_MODEL);
  if (!fallback) {
    throw new Error(`Default model missing from MODEL_PRICING: ${DEFAULT_MODEL}`);
  }
  const p = MODEL_PRICING.find((m) => m.model === requested) ?? fallback;
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
