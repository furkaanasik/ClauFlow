import { describe, it, expect } from "vitest";
import {
  ADVISOR_SUPPORTED,
  getClaudeCapabilities,
  isValidAdvisor,
  modelRank,
} from "./claudeCapabilities.js";

describe("claudeCapabilities", () => {
  it("ranks aliases and full ids haiku < sonnet < opus < fable", () => {
    expect(modelRank("haiku")).toBe(0);
    expect(modelRank("sonnet")).toBe(1);
    expect(modelRank("claude-opus-5-5")).toBe(2);
    expect(modelRank("fable")).toBe(3);
    expect(modelRank("gpt-4")).toBeNull();
  });

  it("rejects weaker, haiku and unknown advisors", () => {
    expect(isValidAdvisor("sonnet", "opus")).toBe(true);
    expect(isValidAdvisor("opus", "opus")).toBe(true);
    expect(isValidAdvisor("opus", "sonnet")).toBe(false);
    expect(isValidAdvisor("haiku", "haiku")).toBe(false);
    expect(isValidAdvisor("sonnet", "mystery")).toBe(false);
  });

  it("reports the spike result", () => {
    expect(getClaudeCapabilities()).toEqual({
      advisor: ADVISOR_SUPPORTED,
      models: ["haiku", "sonnet", "opus", "fable"],
    });
  });
});
