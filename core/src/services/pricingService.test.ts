import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  MODEL_PRICING,
  calculateCostUsd,
  getActivePricing,
} from "./pricingService.js";

describe("calculateCostUsd", () => {
  const sonnet45 = MODEL_PRICING.find((m) => m.model === "claude-sonnet-4-5")!;

  it("zero usage returns 0", () => {
    expect(
      calculateCostUsd(
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        "claude-sonnet-4-5",
      ),
    ).toBe(0);
  });

  it("1M input tokens of Sonnet 4.5 == inputPerM", () => {
    const cost = calculateCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      "claude-sonnet-4-5",
    );
    expect(cost).toBeCloseTo(sonnet45.inputPerM, 6);
  });

  it("mixed usage uses correct per-bucket rate", () => {
    const cost = calculateCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
      "claude-sonnet-4-5",
    );
    const expected =
      sonnet45.inputPerM +
      sonnet45.outputPerM +
      sonnet45.cacheCreationPerM +
      sonnet45.cacheReadPerM;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("unknown model falls back to default Sonnet 4.5 pricing (no throw)", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    expect(calculateCostUsd(usage, "claude-fake-model")).toBeCloseTo(
      sonnet45.inputPerM,
      6,
    );
  });

  it("null model uses DEFAULT_MODEL", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    expect(calculateCostUsd(usage, null)).toBeCloseTo(sonnet45.inputPerM, 6);
  });

  it("undefined model uses DEFAULT_MODEL", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    expect(calculateCostUsd(usage)).toBeCloseTo(sonnet45.inputPerM, 6);
  });

  it("Opus 4.7 input pricing differs from Sonnet 4.5", () => {
    const opus = MODEL_PRICING.find((m) => m.model === "claude-opus-4-7")!;
    expect(opus.inputPerM).toBeGreaterThan(sonnet45.inputPerM);
    const cost = calculateCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      "claude-opus-4-7",
    );
    expect(cost).toBeCloseTo(opus.inputPerM, 6);
  });
});

describe("getActivePricing", () => {
  it("returns a copy, not the live array", () => {
    const a = getActivePricing();
    const b = getActivePricing();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("includes the DEFAULT_MODEL entry", () => {
    expect(
      getActivePricing().some((m) => m.model === DEFAULT_MODEL),
    ).toBe(true);
  });
});
