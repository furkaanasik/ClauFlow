import { describe, expect, it } from "vitest";
import { parseChecksJson, buildFailureArtifact } from "./ciService.js";

describe("parseChecksJson", () => {
  it("returns pending for invalid JSON", () => {
    expect(parseChecksJson("not-json")).toEqual({ kind: "pending" });
  });

  it("returns pending for non-array JSON", () => {
    expect(parseChecksJson('{"foo":"bar"}')).toEqual({ kind: "pending" });
  });

  it("returns no_checks for empty array", () => {
    expect(parseChecksJson("[]")).toEqual({ kind: "no_checks" });
  });

  it("returns pending when any check is still in progress", () => {
    const checks = [
      { name: "build", bucket: "pass" },
      { name: "test", bucket: "pending" },
    ];
    expect(parseChecksJson(JSON.stringify(checks))).toEqual({ kind: "pending" });
  });

  it("returns pass when all checks succeed", () => {
    const checks = [
      { name: "build", bucket: "pass" },
      { name: "lint", bucket: "pass" },
    ];
    expect(parseChecksJson(JSON.stringify(checks))).toEqual({ kind: "pass" });
  });

  it("returns pass for mixed pass and skipping", () => {
    const checks = [
      { name: "build", bucket: "pass" },
      { name: "optional", bucket: "skipping" },
    ];
    expect(parseChecksJson(JSON.stringify(checks))).toEqual({ kind: "pass" });
  });

  it("returns fail with mapped failures when a check fails", () => {
    const checks = [
      { name: "unit-tests", bucket: "fail", link: "https://github.com/org/repo/actions/runs/123" },
      { name: "build", bucket: "pass", link: null },
    ];
    const result = parseChecksJson(JSON.stringify(checks));
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.jobName).toBe("unit-tests");
      expect(result.failures[0]!.conclusion).toBe("FAILURE");
      expect(result.failures[0]!.link).toBe("https://github.com/org/repo/actions/runs/123");
      expect(result.failures[0]!.logTail).toBeNull();
    }
  });

  it("returns fail for cancel bucket", () => {
    const result = parseChecksJson(JSON.stringify([
      { name: "deploy", bucket: "cancel", link: null },
    ]));
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.failures[0]!.conclusion).toBe("CANCELLED");
    }
  });

  it("returns fail for error bucket", () => {
    const result = parseChecksJson(JSON.stringify([
      { name: "e2e", bucket: "error", link: null },
    ]));
    expect(result.kind).toBe("fail");
  });

  it("collects multiple failures in one verdict", () => {
    const checks = [
      { name: "test", bucket: "fail", link: null },
      { name: "lint", bucket: "fail", link: null },
    ];
    const result = parseChecksJson(JSON.stringify(checks));
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.failures).toHaveLength(2);
    }
  });
});

describe("buildFailureArtifact", () => {
  it("enriches failures with logTail matched by run id from link", () => {
    const failures = [
      {
        jobName: "test",
        conclusion: "FAILURE" as const,
        link: "https://github.com/org/repo/actions/runs/42/job/99",
        logTail: null,
      },
    ];
    const logMap = new Map([["42", "error: test failed\n...tail"]]);
    const artifact = buildFailureArtifact(7, 1, failures, logMap);

    expect(artifact.prNumber).toBe(7);
    expect(artifact.iteration).toBe(1);
    expect(artifact.failures[0]!.logTail).toBe("error: test failed\n...tail");
    expect(artifact.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("leaves logTail null when link is null", () => {
    const failures = [
      { jobName: "test", conclusion: "FAILURE" as const, link: null, logTail: null },
    ];
    const artifact = buildFailureArtifact(1, 0, failures, new Map());
    expect(artifact.failures[0]!.logTail).toBeNull();
  });

  it("leaves logTail null when run id not found in logMap", () => {
    const failures = [
      { jobName: "test", conclusion: "FAILURE" as const, link: "https://github.com/org/repo/actions/runs/999", logTail: null },
    ];
    const artifact = buildFailureArtifact(1, 0, failures, new Map());
    expect(artifact.failures[0]!.logTail).toBeNull();
  });

  it("handles empty failures list", () => {
    const artifact = buildFailureArtifact(5, 2, [], new Map());
    expect(artifact.failures).toHaveLength(0);
    expect(artifact.prNumber).toBe(5);
    expect(artifact.iteration).toBe(2);
  });
});
