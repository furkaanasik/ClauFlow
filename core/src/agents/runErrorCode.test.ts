import { describe, expect, it } from "vitest";
import { runErrorCode } from "./runErrorCode.js";
import { GhMissingError } from "../services/gitService.js";
import { BaseBranchMissing } from "../services/baseBranch.js";

describe("runErrorCode (zincir E2, plan §3/22)", () => {
  it("git checkout/pull failed → git_checkout_failed:<first stderr line>", () => {
    expect(runErrorCode(new Error("git checkout/pull failed:\nerror: pathspec 'x' did not match any file(s) known to git\nmore"))).toBe(
      "git_checkout_failed:error: pathspec 'x' did not match any file(s) known to git",
    );
  });

  it("git checkout -b failed → git_checkout_failed:<first stderr line>", () => {
    expect(runErrorCode(new Error("git checkout -b failed:\n\nfatal: a branch named 'f' already exists\n"))).toBe(
      "git_checkout_failed:fatal: a branch named 'f' already exists",
    );
  });

  it("caps the checkout detail at 200 characters", () => {
    const code = runErrorCode(new Error(`git checkout/pull failed:\n${"e".repeat(400)}`));
    expect(code).toBe(`git_checkout_failed:${"e".repeat(200)}`);
  });

  it("push, PR and CLI exits map to their codes", () => {
    expect(runErrorCode(new Error("git push failed:\n! [rejected]"))).toBe("git_push_failed");
    expect(runErrorCode(new Error("gh pr create failed:\nno upstream"))).toBe("pr_create_failed");
    expect(runErrorCode(new Error("claude CLI exited 1:\nboom"))).toBe("claude_exit");
  });

  it("gh missing: the typed error and a raw spawn ENOENT", () => {
    expect(runErrorCode(new GhMissingError())).toBe("gh_missing");
    expect(runErrorCode(new Error("spawn gh ENOENT"))).toBe("gh_missing");
  });

  it("already-coded messages pass through unchanged", () => {
    expect(runErrorCode(new BaseBranchMissing("main"))).toBe("base_branch_missing:main");
    expect(runErrorCode(new Error("base_branch_missing:-"))).toBe("base_branch_missing:-");
    expect(runErrorCode(new Error("role_timeout:qa"))).toBe("role_timeout:qa");
  });

  it("anything else → run_failed:<first 120 chars, newlines flattened>", () => {
    expect(runErrorCode(new Error("git commit failed:\nerror: nope"))).toBe("run_failed:git commit failed: error: nope");
    const long = runErrorCode(new Error(`random\n${"x".repeat(300)}`));
    expect(long.startsWith("run_failed:random ")).toBe(true);
    expect(long.length).toBe("run_failed:".length + 120);
    expect(long).not.toMatch(/\n/);
    expect(runErrorCode("plain string")).toBe("run_failed:plain string");
  });
});
