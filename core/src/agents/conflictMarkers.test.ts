import { describe, expect, it } from "vitest";
import { findConflictMarkers, parseDiffCheck, parseMergeSubject } from "./conflictMarkers.js";

describe("findConflictMarkers (zincir F4.6, plan §3/38, Z43)", () => {
  it("a two-sided block yields start, sep and end with 1-based lines", () => {
    const text = ["a", "<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> main", "b"].join("\n");
    expect(findConflictMarkers(text)).toEqual([
      { line: 2, kind: "start" },
      { line: 4, kind: "sep" },
      { line: 6, kind: "end" },
    ]);
  });

  it("a diff3 block also yields the base marker", () => {
    const text = ["<<<<<<< HEAD", "ours", "||||||| merged common ancestors", "base", "=======", "theirs", ">>>>>>> main"].join("\n");
    expect(findConflictMarkers(text).map((m) => m.kind)).toEqual(["start", "base", "sep", "end"]);
  });

  it("finds every block in a file, with CRLF line ends too", () => {
    const block = ["<<<<<<< HEAD", "x", "=======", "y", ">>>>>>> main"];
    const text = [...block, "middle", ...block].join("\r\n");
    const found = findConflictMarkers(text);
    expect(found).toHaveLength(6);
    expect(found.map((m) => m.line)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it("text without markers → []", () => {
    expect(findConflictMarkers("plain\ntext\n")).toEqual([]);
    expect(findConflictMarkers("")).toEqual([]);
  });

  it("a bare ======= (Markdown setext heading) is not a marker on its own", () => {
    expect(findConflictMarkers("Title\n=======\n\nbody\n")).toEqual([]);
    // After a closed block it is not one either.
    const text = ["<<<<<<< HEAD", "a", ">>>>>>> main", "Heading", "======="].join("\n");
    expect(findConflictMarkers(text).map((m) => m.kind)).toEqual(["start", "end"]);
  });

  it("======= after an opening <<<<<<< is a separator", () => {
    expect(findConflictMarkers("<<<<<<< HEAD\n=======\n")).toEqual([
      { line: 1, kind: "start" },
      { line: 2, kind: "sep" },
    ]);
  });

  it("markers that do not start the line, or have extra characters, are not markers", () => {
    expect(findConflictMarkers('const s = "<<<<<<< HEAD";\n  >>>>>>> x\n')).toEqual([]);
    expect(findConflictMarkers("<<<<<<<< eight\n<<<<<<<x\n>>>>>>>>\n")).toEqual([]);
    expect(findConflictMarkers("<<<<<<<\n========\n>>>>>>>").map((m) => m.kind)).toEqual(["start", "end"]);
  });
});

describe("parseDiffCheck (Z43)", () => {
  it("keeps only the leftover conflict marker lines", () => {
    const out = [
      "a.ts:3: leftover conflict marker",
      "+<<<<<<< HEAD",
      "b.md:7: trailing whitespace.",
      "+some text   ",
      "",
    ].join("\n");
    expect(parseDiffCheck(out)).toEqual(["a.ts:3: leftover conflict marker"]);
  });

  it("empty output and whitespace-only problems → []", () => {
    expect(parseDiffCheck("")).toEqual([]);
    expect(parseDiffCheck("c.txt:1: space before tab in indent.\n+ \tx\n")).toEqual([]);
  });

  it("handles paths with spaces and several markers", () => {
    expect(
      parseDiffCheck("dir/my file.ts:1: leftover conflict marker\n+<<<<<<< HEAD\nx.ts:9: leftover conflict marker\n+>>>>>>> main\n"),
    ).toEqual(["dir/my file.ts:1: leftover conflict marker", "x.ts:9: leftover conflict marker"]);
  });
});

describe("parseMergeSubject (plan §3/37, Z41)", () => {
  it("ClauFlow local merge subject → displayId + branch", () => {
    expect(parseMergeSubject("Merge feature/clf-4-x (CLF-4)")).toEqual({ displayId: "CLF-4", branch: "feature/clf-4-x" });
  });

  it("GitHub PR merge subject → prNumber + branch (owner stripped, slashes kept)", () => {
    expect(parseMergeSubject("Merge pull request #12 from acme/feature/clf-4-x")).toEqual({
      prNumber: 12,
      branch: "feature/clf-4-x",
    });
  });

  it("ClauFlow resolver subject → the resolved task's displayId + branch", () => {
    expect(
      parseMergeSubject("Merge main into feature/clf-5-y (CLF-5): conflicts resolved by ClauFlow"),
    ).toEqual({ displayId: "CLF-5", branch: "feature/clf-5-y" });
  });

  it("plain git subjects → the merged-in branch (decision §10)", () => {
    expect(parseMergeSubject("Merge branch 'main' into x")).toEqual({ branch: "main" });
    expect(parseMergeSubject("Merge branch 'feature/clf-4-x'")).toEqual({ branch: "feature/clf-4-x" });
    expect(parseMergeSubject("Merge remote-tracking branch 'origin/feature/clf-4-x' into main")).toEqual({
      branch: "feature/clf-4-x",
    });
  });

  it("ordinary subjects → null", () => {
    expect(parseMergeSubject("fix: typo in README")).toBeNull();
    expect(parseMergeSubject("Merge the docs")).toBeNull();
    expect(parseMergeSubject("")).toBeNull();
  });
});
