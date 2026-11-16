import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import { checkoutBase, commitAll } from "./gitService.js";

// bakim #7 (plan §3/10–13): the shield wired into checkoutBase and commitAll.

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const r = makeRepo("clauflow-hygiene-");
  dirs.push(r);
  git(r, "checkout", "-q", "-b", "feature/x");
  return r;
}

function touch(r: string, rel: string, body = "x\n"): void {
  const f = join(r, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, body);
}

function nodeModules(r: string, n = 5): void {
  for (let i = 0; i < n; i++) touch(r, `node_modules/pkg${i}/index.js`, `module.exports = ${i};\n`);
}

const exclude = (r: string) => readFileSync(join(r, ".git", "info", "exclude"), "utf8");

describe("checkoutBase shield", () => {
  it("(1) only untracked node_modules/ + .next/ → no stash, folders stay, block written, note in stdout", async () => {
    const r = repo();
    nodeModules(r);
    touch(r, ".next/cache/x");

    const res = await checkoutBase(r, "main");

    expect(res.code).toBe(0);
    expect(res.stashed).toBeUndefined();
    expect(git(r, "stash", "list")).toBe("");
    expect(git(r, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(readdirSync(join(r, "node_modules")).length).toBe(5);
    expect(existsSync(join(r, ".next", "cache", "x"))).toBe(true);
    expect(exclude(r)).toContain("\n/node_modules/\n");
    expect(exclude(r)).toContain("\n/.next/\n");
    expect(res.stdout).toMatch(/\[kanban\] ignored locally: .*node_modules\//);
    expect(res.stdout).not.toContain("auto-stashed");
  });

  it("(2) node_modules/ + an untracked notes.md → the stash holds only notes.md", async () => {
    const r = repo();
    nodeModules(r);
    touch(r, "notes.md", "real work\n");

    const res = await checkoutBase(r, "main", { taskId: "task_x" });

    expect(res.code).toBe(0);
    expect(res.stashed).toMatch(/^kanban-auto-task_x-/);
    expect(git(r, "ls-tree", "-r", "--name-only", "stash@{0}^3")).toBe("notes.md");
    expect(readdirSync(join(r, "node_modules")).length).toBe(5);
    expect(existsSync(join(r, "notes.md"))).toBe(false);
    expect(res.stdout).toContain("auto-stashed");
    expect(res.stdout).toContain("ignored locally");
  });

  it("(3) node_modules/ ignored by .gitignore + a tracked change → stash^3 has no node_modules, it stays on disk (§3/13)", async () => {
    const r = repo();
    writeFileSync(join(r, ".gitignore"), "node_modules/\n");
    git(r, "add", ".gitignore");
    git(r, "commit", "-q", "-m", "ignore");
    git(r, "checkout", "-q", "main");
    git(r, "merge", "-q", "feature/x");
    git(r, "checkout", "-q", "feature/x");
    nodeModules(r);
    writeFileSync(join(r, "README.md"), "# edited\n");
    touch(r, "stray.txt");

    const res = await checkoutBase(r, "main");

    expect(res.code).toBe(0);
    expect(res.stashed).toBeDefined();
    expect(res.stdout).not.toContain("ignored locally");
    expect(git(r, "ls-tree", "-r", "--name-only", "stash@{0}^3")).toBe("stray.txt");
    expect(git(r, "stash", "show", "--name-only", "stash@{0}")).toBe("README.md");
    expect(readdirSync(join(r, "node_modules")).length).toBe(5);
  });

  it("(5) an untracked build/ is still stashed as before (§3/11)", async () => {
    const r = repo();
    touch(r, "build/script.sh", "#!/bin/sh\n");

    const res = await checkoutBase(r, "main");

    expect(res.code).toBe(0);
    expect(res.stashed).toBeDefined();
    expect(git(r, "ls-tree", "-r", "--name-only", "stash@{0}^3")).toBe("build/script.sh");
    expect(existsSync(join(r, "build"))).toBe(false);
  });

  it("the 'would be overwritten' stash point is shielded too", async () => {
    const r = repo();
    // main tracks a file the feature branch does not; an untracked copy blocks checkout.
    git(r, "checkout", "-q", "main");
    touch(r, "conf.txt", "main\n");
    git(r, "add", "conf.txt");
    git(r, "commit", "-q", "-m", "conf");
    git(r, "checkout", "-q", "feature/x");
    touch(r, "conf.txt", "local\n");
    nodeModules(r);

    const res = await checkoutBase(r, "main");

    expect(res.code).toBe(0);
    expect(res.stashed).toBeDefined();
    expect(git(r, "ls-tree", "-r", "--name-only", "stash@{0}^3")).toBe("conf.txt");
    expect(readdirSync(join(r, "node_modules")).length).toBe(5);
  });
});

describe("commitAll shield", () => {
  it("(4) on the task branch, commitAll does not commit an untracked node_modules/", async () => {
    const r = repo();
    nodeModules(r);
    touch(r, "src/app.ts", "export {};\n");

    const res = await commitAll(r, "feat: app");

    expect(res.code).toBe(0);
    expect(git(r, "show", "--name-only", "--format=", "HEAD")).toBe("src/app.ts");
    expect(git(r, "status", "--porcelain")).toBe("");
    expect(readdirSync(join(r, "node_modules")).length).toBe(5);
  });
});
