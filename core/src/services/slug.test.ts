import { describe, it, expect } from "vitest";
import { slugify, ensureUniqueSlug } from "./slug.js";

describe("slugify", () => {
  it("converts Turkish characters to ASCII equivalents", () => {
    expect(slugify("şçğıöü")).toBe("scgiou");
    expect(slugify("ŞÇĞİÖÜ")).toBe("scgiou");
  });

  it("converts whitespace to hyphens and lowercases", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses special characters into single hyphens", () => {
    expect(slugify("foo/bar.baz")).toBe("foo-bar-baz");
    expect(slugify("a   b___c")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
    expect(slugify("!!foo!!")).toBe("foo");
  });

  it("passes already-clean input through unchanged", () => {
    expect(slugify("hello-world")).toBe("hello-world");
    expect(slugify("abc123")).toBe("abc123");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("returns empty string when no alphanumerics remain", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("respects maxLength and trims trailing hyphens after truncation", () => {
    const out = slugify("a".repeat(60), 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toBe("aaaaaaaaaa");
    const trimmed = slugify("aaaa-bbbb-cccc", 5);
    expect(trimmed.endsWith("-")).toBe(false);
  });

  it("handles mixed Turkish and English with whitespace", () => {
    expect(slugify("Merhaba Dünya")).toBe("merhaba-dunya");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when not taken", () => {
    expect(ensureUniqueSlug("Hello World", [])).toBe("hello-world");
  });

  it("appends a counter when slug already taken", () => {
    expect(ensureUniqueSlug("Hello", ["hello"])).toBe("hello-2");
    expect(ensureUniqueSlug("Hello", ["hello", "hello-2"])).toBe("hello-3");
  });

  it("falls back to 'project' when input has no usable characters", () => {
    expect(ensureUniqueSlug("!!!", [])).toBe("project");
  });
});
