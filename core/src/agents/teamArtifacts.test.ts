import { describe, expect, it } from "vitest";
import {
  extractSpecAcceptanceCriteria,
  isStalled,
  jaccard,
  normalizeBug,
  parseQaVerdict,
} from "./teamArtifacts.js";

describe("parseQaVerdict", () => {
  it("reads PASS from the last lines", () => {
    const r = parseQaVerdict("## QA raporu\n\n- AC-1: ✓\n\nTests: 1 passed.\n\nVERDICT: PASS");
    expect(r).toEqual({ verdict: "pass", hadVerdict: true, bugs: [], bugListText: "" });
  });

  it("reads FAIL and the numbered bug list", () => {
    const r = parseQaVerdict(
      "## QA raporu\n\n- AC-1: ✗\n\nVERDICT: FAIL\n\n## Hata listesi\n\n1. AC-1 is not met.\n2. Missing test\n   for the error path.\n",
    );
    expect(r.verdict).toBe("fail");
    expect(r.hadVerdict).toBe(true);
    expect(r.bugs).toEqual(["AC-1 is not met.", "Missing test for the error path."]);
    expect(r.bugListText).toContain("1. AC-1 is not met.");
  });

  it("accepts decorated verdict lines and English bug headings", () => {
    const r = parseQaVerdict("Report\n\n**VERDICT: FAIL**\n\n### Bug list\n- one\n- two");
    expect(r.verdict).toBe("fail");
    expect(r.bugs).toEqual(["one", "two"]);
  });

  it("uses the last verdict line when the report quotes the format", () => {
    const r = parseQaVerdict("Format is VERDICT: PASS or FAIL.\nVERDICT: PASS\n...\nVERDICT: FAIL\n## Hata listesi\n1. x");
    expect(r.verdict).toBe("fail");
  });

  it("treats a missing verdict as FAIL with the whole text as the bug list", () => {
    const text = "## QA raporu\n\nSomething looks off but I forgot the verdict line.";
    const r = parseQaVerdict(text);
    expect(r.verdict).toBe("fail");
    expect(r.hadVerdict).toBe(false);
    expect(r.bugListText).toBe(text);
    expect(r.bugs).toEqual([text]);
  });

  it("FAIL without a bug section falls back to the whole report", () => {
    const r = parseQaVerdict("AC-1 broken\nVERDICT: FAIL");
    expect(r.bugs).toEqual(["AC-1 broken\nVERDICT: FAIL"]);
  });
});

describe("isStalled", () => {
  const bugs = ["AC-1 is not met: the function ignores empty input.", "The test file does not cover the error path."];

  it("normalizes case, punctuation, digits and spaces", () => {
    expect(normalizeBug("  AC-1 is NOT met:   the function!! ")).toBe("ac is not met the function");
  });

  it("identical lists are stalled", () => {
    expect(isStalled(bugs, [...bugs])).toBe(true);
  });

  it("reworded but essentially same lists are stalled (above threshold)", () => {
    const again = ["AC-2 is not met — the function ignores empty input", "The test file does not cover the error path!"];
    expect(isStalled(bugs, again)).toBe(true);
  });

  it("different lists are not stalled (below threshold)", () => {
    expect(isStalled(bugs, ["Charlie route returns the wrong status for duplicates."])).toBe(false);
  });

  it("threshold boundary: exactly 0.8 counts as stalled", () => {
    const a = ["one two three four"];
    const b = ["one two three four five"];
    expect(jaccard(new Set(["one", "two", "three", "four"]), new Set(["one", "two", "three", "four", "five"]))).toBe(0.8);
    expect(isStalled(a, b)).toBe(true);
    expect(isStalled(a, ["one two three four five six"])).toBe(false);
  });

  it("empty lists never count as stalled", () => {
    expect(isStalled([], [])).toBe(false);
    expect(isStalled(bugs, [])).toBe(false);
  });
});

describe("extractSpecAcceptanceCriteria", () => {
  it("takes the acceptance criteria section", () => {
    const spec = "## Şartname\n\n### Kabul kriterleri\n- AC-1: a\n- AC-2: b\n\n### Test önerisi\n- ls";
    expect(extractSpecAcceptanceCriteria(spec)).toBe("- AC-1: a\n- AC-2: b");
  });

  it("falls back to AC lines", () => {
    expect(extractSpecAcceptanceCriteria("x\nAC-1 works\ny")).toBe("AC-1 works");
    expect(extractSpecAcceptanceCriteria("nothing")).toBeNull();
  });
});
