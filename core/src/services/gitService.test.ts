import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import { checkoutBase, pushBranch } from "./gitService.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const r = makeRepo("clauflow-git-");
  dirs.push(r);
  return r;
}

function commitFile(r: string, name: string, body: string, msg: string): void {
  writeFileSync(join(r, name), body);
  git(r, "add", "-A");
  git(r, "commit", "-q", "-m", msg);
}

describe("checkoutBase (A5)", () => {
  it("stashes a dirty tree in a repo without a remote instead of carrying it to base", async () => {
    const r = repo();
    git(r, "checkout", "-q", "-b", "feature/x");
    writeFileSync(join(r, "README.md"), "# dirty edit\n");
    writeFileSync(join(r, "stray.txt"), "untracked\n");

    const res = await checkoutBase(r, "main");

    expect(res.code).toBe(0);
    expect(git(r, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(r, "status", "--porcelain")).toBe("");
    expect(res.stdout).toMatch(/\[kanban\] working tree had dirty files; auto-stashed as "kanban-auto-/);
    const stash = git(r, "stash", "list");
    expect(stash).toMatch(/kanban-auto-/);
    expect(git(r, "stash", "show", "--include-untracked", "--name-only", "stash@{0}").split("\n").sort()).toEqual([
      "README.md",
      "stray.txt",
    ]);
  });

  it("a clean tree without a remote creates no stash", async () => {
    const r = repo();
    const res = await checkoutBase(r, "main");
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("[kanban]");
    expect(git(r, "stash", "list")).toBe("");
  });
});

describe("pushBranch (A6)", () => {
  it("pushes with --force-with-lease so a recreated branch can be pushed again", async () => {
    const r = repo();
    const origin = mkdtempSync(join(tmpdir(), "clauflow-origin-"));
    dirs.push(origin);
    execFileSync("git", ["init", "-q", "--bare", origin]);
    git(r, "remote", "add", "origin", origin);

    git(r, "checkout", "-q", "-b", "feature/clf-1-x");
    commitFile(r, "a.txt", "first attempt\n", "feat: first attempt");
    const first = await pushBranch(r, "feature/clf-1-x");
    expect(first.code).toBe(0);

    // A retry recreates the branch from base with different history.
    git(r, "checkout", "-q", "main");
    git(r, "branch", "-D", "feature/clf-1-x");
    git(r, "checkout", "-q", "-b", "feature/clf-1-x");
    commitFile(r, "b.txt", "second attempt\n", "feat: second attempt");
    const second = await pushBranch(r, "feature/clf-1-x");

    expect(second.code).toBe(0);
    expect(execFileSync("git", ["-C", origin, "log", "--format=%s", "feature/clf-1-x"], { encoding: "utf8" }).trim()).toBe(
      "feat: second attempt\ninit",
    );
    expect(git(r, "rev-parse", "--abbrev-ref", "feature/clf-1-x@{upstream}")).toBe("origin/feature/clf-1-x");
  });
});
