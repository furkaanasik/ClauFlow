import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import {
  EXCLUDE_BLOCK_END,
  EXCLUDE_BLOCK_START,
  checkoutBase,
  ensureLocalExcludes,
  pushBranch,
  shieldNoiseDirs,
} from "./gitService.js";

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

function excludeOf(r: string): string {
  const f = join(r, ".git", "info", "exclude");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

function touch(r: string, rel: string, body = "x\n"): void {
  const f = join(r, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, body);
}

describe("ensureLocalExcludes (bakim #7)", () => {
  it("creates the labelled block, adds only missing lines, and is idempotent", async () => {
    const r = repo();
    const f = join(r, ".git", "info", "exclude");
    writeFileSync(f, "# user's own\n*.tmp\n");

    expect(await ensureLocalExcludes(r, ["/node_modules/"])).toEqual(["/node_modules/"]);
    let body = readFileSync(f, "utf8");
    expect(body.startsWith("# user's own\n*.tmp\n")).toBe(true);
    expect(body).toContain(`${EXCLUDE_BLOCK_START}\n/node_modules/\n${EXCLUDE_BLOCK_END}\n`);

    // Existing block: the missing line goes inside it.
    expect(await ensureLocalExcludes(r, ["/node_modules/", "/.next/"])).toEqual(["/.next/"]);
    body = readFileSync(f, "utf8");
    expect(body).toContain(`${EXCLUDE_BLOCK_START}\n/node_modules/\n/.next/\n${EXCLUDE_BLOCK_END}\n`);
    expect(body.split(EXCLUDE_BLOCK_START).length).toBe(2);

    // Second call: file untouched.
    const before = readFileSync(f, "utf8");
    expect(await ensureLocalExcludes(r, ["/node_modules/", "/.next/"])).toEqual([]);
    expect(readFileSync(f, "utf8")).toBe(before);
  });

  it("creates info/exclude when it does not exist", async () => {
    const r = repo();
    rmSync(join(r, ".git", "info"), { recursive: true, force: true });
    expect(await ensureLocalExcludes(r, ["/dist/"])).toEqual(["/dist/"]);
    expect(excludeOf(r)).toBe(`${EXCLUDE_BLOCK_START}\n/dist/\n${EXCLUDE_BLOCK_END}\n`);
  });

  it("writes the common exclude file from a linked worktree (--git-path)", async () => {
    const r = repo();
    const wt = mkdtempSync(join(tmpdir(), "clauflow-wt-"));
    dirs.push(wt);
    rmSync(wt, { recursive: true, force: true });
    git(r, "worktree", "add", "-q", "-b", "wt-branch", wt);
    touch(wt, "node_modules/a/index.js");

    expect(await shieldNoiseDirs(wt)).toEqual(["node_modules/"]);
    expect(excludeOf(r)).toContain("/node_modules/");
    expect(git(wt, "status", "--porcelain")).toBe("");
    expect(existsSync(join(wt, "node_modules", "a", "index.js"))).toBe(true);
  });
});

describe("shieldNoiseDirs (bakim #7, §3/10)", () => {
  it("excludes a wholly untracked node_modules/ and .next/ and nothing else", async () => {
    const r = repo();
    touch(r, "node_modules/pkg/index.js");
    touch(r, "node_modules/pkg/lib/deep.js");
    touch(r, ".next/cache/x");
    touch(r, "notes.md");

    expect((await shieldNoiseDirs(r)).sort()).toEqual([".next/", "node_modules/"]);
    expect(excludeOf(r)).toContain("\n/node_modules/\n");
    expect(excludeOf(r)).toContain("\n/.next/\n");
    expect(git(r, "status", "--porcelain")).toBe("?? notes.md");
    // Second call: nothing new.
    expect(await shieldNoiseDirs(r)).toEqual([]);
  });

  it("finds node_modules/ as one root even with status.showUntrackedFiles=all", async () => {
    const r = repo();
    git(r, "config", "status.showUntrackedFiles", "all");
    touch(r, "node_modules/a/b/c.js");
    touch(r, "node_modules/d.js");
    expect(await shieldNoiseDirs(r)).toEqual(["node_modules/"]);
    expect(git(r, "status", "--porcelain")).toBe("");
  });

  it("handles folder names with spaces (-z) and nested roots", async () => {
    const r = repo();
    commitFile(r, "keep.txt", "k\n", "keep");
    touch(r, "my app/src/a.ts");
    git(r, "add", "my app/src/a.ts");
    git(r, "commit", "-q", "-m", "app");
    touch(r, "my app/node_modules/x/index.js");

    expect(await shieldNoiseDirs(r)).toEqual(["my app/node_modules/"]);
    expect(excludeOf(r)).toContain("/my app/node_modules/");
    expect(git(r, "status", "--porcelain")).toBe("");
  });

  it("leaves a dist/ that holds tracked files alone (only the new file is untracked)", async () => {
    const r = repo();
    touch(r, "dist/tracked.js");
    git(r, "add", "dist/tracked.js");
    git(r, "commit", "-q", "-m", "dist");
    touch(r, "dist/new.js");

    expect(await shieldNoiseDirs(r)).toEqual([]);
    expect(excludeOf(r)).not.toContain("/dist/");
    expect(git(r, "status", "--porcelain")).toBe("?? dist/new.js");
  });

  it("never shields ambiguous folders such as build/, out/, vendor/", async () => {
    const r = repo();
    touch(r, "build/script.sh");
    touch(r, "out/x.txt");
    touch(r, "vendor/lib.go");
    expect(await shieldNoiseDirs(r)).toEqual([]);
    expect(excludeOf(r)).not.toContain(EXCLUDE_BLOCK_START);
  });

  it("returns [] outside a git repository instead of throwing", async () => {
    const d = mkdtempSync(join(tmpdir(), "clauflow-nogit-"));
    dirs.push(d);
    touch(d, "node_modules/x.js");
    expect(await shieldNoiseDirs(d)).toEqual([]);
  });
});
