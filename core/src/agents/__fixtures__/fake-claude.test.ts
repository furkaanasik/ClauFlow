import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findConflictMarkers } from "../conflictMarkers.js";
import { installFakeGh } from "../../test-utils/fakeGh.js";
import { processGone, readHangPids } from "../../test-utils/fakeRepo.js";

const FAKE_CLAUDE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));

interface RunOpts {
  env?: Record<string, string>;
  prompt?: string;
}

function run(dir: string, scenario: string, role: string, round: number, extra: string[] = [], opts: RunOpts = {}) {
  const res = spawnSync(
    FAKE_CLAUDE,
    [
      "-p",
      opts.prompt ?? "task",
      "--model",
      "sonnet",
      "--append-system-prompt",
      `<!-- clauflow-role: ${role} round: ${round} -->`,
      "--output-format",
      "stream-json",
      "--verbose",
      ...extra,
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, FAKE_CLAUDE_SCENARIO: scenario, FAKE_CLAUDE_STATE: join(dir, "state"), ...opts.env },
    },
  );
  const events = res.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const result = events.find((e) => e.type === "result") as { result?: string; total_cost_usd?: number } | undefined;
  return { status: res.status, stderr: res.stderr, events, text: result?.result ?? "", cost: result?.total_cost_usd };
}

describe("fake-claude fixture", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("emits init, assistant and result events with the resolved model", () => {
    const r = run(dir, "pass", "ceo", 0);
    expect(r.status).toBe(0);
    expect(r.events.map((e) => e.type)).toEqual(["system", "assistant", "result"]);
    expect(r.events[0]).toMatchObject({ subtype: "init", model: "claude-sonnet-5-5" });
    expect(r.text).toContain("## Brief");
  });

  it("developer writes fake-<round>.txt", () => {
    run(dir, "pass", "developer", 2);
    expect(existsSync(join(dir, "fake-2.txt"))).toBe(true);
  });

  it("developer appends a branch line when fake-<round>.txt already exists (zincir Z16)", () => {
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "feature/clf-3-b");
    run(dir, "pass", "developer", 1);
    expect(readFileSync(join(dir, "fake-1.txt"), "utf8")).toBe("fake developer output round 1\n");
    run(dir, "pass", "developer", 1);
    expect(readFileSync(join(dir, "fake-1.txt"), "utf8")).toBe(
      "fake developer output round 1\nfake developer output on feature/clf-3-b round 1\n",
    );
  });

  it("fail_then_pass fails the first QA call and passes the second", () => {
    expect(run(dir, "fail_then_pass", "qa", 1).text).toContain("VERDICT: FAIL");
    expect(run(dir, "fail_then_pass", "qa", 2).text).toContain("VERDICT: PASS");
  });

  it("stuck repeats the same bug list, always_fail rotates it", () => {
    const s1 = run(dir, "stuck", "qa", 1).text;
    const s2 = run(dir, "stuck", "qa", 2).text;
    expect(s1).toBe(s2);
    const other = mkdtempSync(join(tmpdir(), "fake-claude-"));
    try {
      const a1 = run(other, "always_fail", "qa", 1).text;
      const a2 = run(other, "always_fail", "qa", 2).text;
      expect(a1).toContain("VERDICT: FAIL");
      expect(a1).not.toBe(a2);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("no_verdict omits the verdict line and exit_error exits non-zero", () => {
    expect(run(dir, "no_verdict", "qa", 1).text).not.toContain("VERDICT");
    const e = run(dir, "exit_error", "developer", 1);
    expect(e.status).toBe(1);
    expect(e.stderr).toContain("simulated failure");
  });

  it("records model, tools and advisor in calls.jsonl", () => {
    run(dir, "pass", "qa", 1, ["--tools", "Read,Bash", "--advisor", "opus"]);
    const call = JSON.parse(readFileSync(join(dir, "state", "calls.jsonl"), "utf8").trim());
    expect(call).toMatchObject({ role: "qa", round: 1, model: "sonnet", tools: "Read,Bash", advisor: "opus" });
  });
});

describe("fake-claude conflict scenarios (zincir F4.6, Z42)", () => {
  let dir: string;
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}`.trim() };
  };
  const CONFLICT = { FAKE_CLAUDE_CONFLICT_FILE: "shared.txt" };

  /**
   * main seeded with shared.txt = "base line"; feature/clf-1-a and feature/clf-2-b
   * branch from it and each run the fake developer; A is merged into main;
   * B (checked out) then merges main and stops on the conflict.
   */
  function siblingConflict(): void {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "fake@clauflow.test");
    git("config", "user.name", "ClauFlow Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, ".gitignore"), "state/\n");
    writeFileSync(join(dir, "shared.txt"), "base line\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    for (const branch of ["feature/clf-1-a", "feature/clf-2-b"]) {
      git("checkout", "-q", "-b", branch, "main");
      expect(run(dir, "pass", "developer", 1, [], { env: CONFLICT }).status).toBe(0);
      git("add", "-A");
      git("commit", "-q", "-m", `work on ${branch}`);
    }
    git("checkout", "-q", "main");
    expect(git("merge", "--no-ff", "-q", "-m", "Merge feature/clf-1-a (CLF-1)", "feature/clf-1-a").code).toBe(0);
    git("checkout", "-q", "feature/clf-2-b");
    expect(git("merge", "--no-ff", "--no-commit", "main").code).not.toBe(0);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fake-claude-conflict-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("FAKE_CLAUDE_CONFLICT_FILE: sibling developer runs change the same line, so merging conflicts", () => {
    siblingConflict();
    expect(git("diff", "--name-only", "--diff-filter=U").out).toBe("shared.txt");
    const text = readFileSync(join(dir, "shared.txt"), "utf8");
    expect(text).toContain("line from feature/clf-2-b");
    expect(text).toContain("line from feature/clf-1-a");
    expect(findConflictMarkers(text).map((m) => m.kind)).toEqual(["start", "sep", "end"]);
  });

  it("keep_both (default) replaces each block with ours + theirs, does not stage, answers a note", () => {
    siblingConflict();
    const r = run(dir, "pass", "conflict_resolver", 1, [], { env: { FAKE_CLAUDE_COST_USD: "0.02" } });
    expect(r.status).toBe(0);
    const text = readFileSync(join(dir, "shared.txt"), "utf8");
    expect(text).toBe("line from feature/clf-2-b\nline from feature/clf-1-a\n");
    expect(findConflictMarkers(text)).toEqual([]);
    expect(git("diff", "--name-only", "--diff-filter=U").out).toBe("shared.txt"); // no `git add`
    expect(r.text).toContain("## Çözüm notu");
    expect(r.text).toContain("shared.txt");
    expect(r.cost).toBe(0.02);
    const calls = readFileSync(join(dir, "state", "calls.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(calls.at(-1)!)).toMatchObject({ role: "conflict_resolver", round: 1 });
  });

  it("keep_both drops a diff3 base section", () => {
    siblingConflict();
    git("checkout", "--conflict=diff3", "shared.txt");
    expect(findConflictMarkers(readFileSync(join(dir, "shared.txt"), "utf8")).map((m) => m.kind)).toContain("base");
    run(dir, "pass", "conflict_resolver", 1);
    expect(readFileSync(join(dir, "shared.txt"), "utf8")).toBe("line from feature/clf-2-b\nline from feature/clf-1-a\n");
  });

  it("leave_markers leaves the conflicted files untouched", () => {
    siblingConflict();
    const before = readFileSync(join(dir, "shared.txt"), "utf8");
    const r = run(dir, "pass", "conflict_resolver", 1, [], { env: { FAKE_CLAUDE_RESOLVE: "leave_markers" } });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, "shared.txt"), "utf8")).toBe(before);
    expect(findConflictMarkers(before)).not.toEqual([]);
  });

  it("qa_fail resolves like keep_both; QA fails only a prompt with <conflict_resolution>", () => {
    siblingConflict();
    const env = { FAKE_CLAUDE_RESOLVE: "qa_fail" };
    run(dir, "pass", "conflict_resolver", 1, [], { env });
    expect(findConflictMarkers(readFileSync(join(dir, "shared.txt"), "utf8"))).toEqual([]);
    const qa = run(dir, "pass", "qa", 1, [], { env, prompt: "review\n<conflict_resolution>\nshared.txt\n</conflict_resolution>" });
    expect(qa.text).toContain("VERDICT: FAIL");
    expect(run(dir, "pass", "qa", 2, [], { env }).text).toContain("VERDICT: PASS");
    expect(
      run(dir, "pass", "qa", 3, [], { prompt: "<conflict_resolution>x</conflict_resolution>" }).text,
    ).toContain("VERDICT: PASS");
  });

  it("hang: the resolver resolves first, then never exits (F4.6 timeout test relies on it)", async () => {
    siblingConflict();
    const state = join(dir, "state");
    const child = spawn(
      FAKE_CLAUDE,
      ["-p", "x", "--append-system-prompt", "<!-- clauflow-role: conflict_resolver round: 1 -->", "--output-format", "stream-json"],
      { cwd: dir, env: { ...process.env, FAKE_CLAUDE_SCENARIO: "hang", FAKE_CLAUDE_STATE: state }, stdio: "ignore" },
    );
    try {
      let pids = readHangPids(state);
      for (let i = 0; !pids && i < 100; i++) {
        await new Promise((r) => setTimeout(r, 50));
        pids = readHangPids(state);
      }
      expect(pids).not.toBeNull();
      expect(findConflictMarkers(readFileSync(join(dir, "shared.txt"), "utf8"))).toEqual([]);
      expect(processGone(pids!.cli)).toBe(false);
      process.kill(pids!.grandchild, "SIGKILL");
      process.kill(pids!.cli, "SIGKILL");
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });

  it("without the conflict variables the developer behaves as before", () => {
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "shared.txt"), "base line\n");
    run(dir, "pass", "developer", 1);
    expect(readFileSync(join(dir, "fake-1.txt"), "utf8")).toBe("fake developer output round 1\n");
    expect(readFileSync(join(dir, "shared.txt"), "utf8")).toBe("base line\n");
    // Outside a merge the resolver finds nothing to do.
    expect(run(dir, "pass", "conflict_resolver", 1).text).toContain("No conflicted files");
  });
});

describe("fake-claude FAKE_CLAUDE_RENAME_BASE (bakim F1, #1)", () => {
  let dir: string;
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "").trim() };
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fake-claude-base-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "fake@clauflow.test");
    git("config", "user.name", "ClauFlow Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "README.md"), "# base\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    git("checkout", "-q", "-b", "feature/clf-1-a");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const branches = () => git("branch", "--format=%(refname:short)").out.split("\n").sort();

  it("main:trunk renames the base after the developer wrote its file", () => {
    const r = run(dir, "pass", "developer", 1, [], { env: { FAKE_CLAUDE_RENAME_BASE: "main:trunk" } });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "fake-1.txt"))).toBe(true);
    expect(branches()).toEqual(["feature/clf-1-a", "trunk"]);
    expect(git("rev-parse", "--verify", "-q", "refs/heads/main").code).not.toBe(0);
    expect(git("symbolic-ref", "--short", "HEAD").out).toBe("feature/clf-1-a");
  });

  it("main: (empty target) deletes the base while the task branch is checked out", () => {
    const r = run(dir, "pass", "developer", 1, [], { env: { FAKE_CLAUDE_RENAME_BASE: "main:" } });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "fake-1.txt"))).toBe(true);
    expect(branches()).toEqual(["feature/clf-1-a"]);
  });

  it("other roles leave the base alone", () => {
    run(dir, "pass", "qa", 1, [], { env: { FAKE_CLAUDE_RENAME_BASE: "main:trunk" } });
    expect(branches()).toEqual(["feature/clf-1-a", "main"]);
  });
});

describe("fake gh pr view / merge conflict (zincir F4.6, §3/34)", () => {
  function gh(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync("gh", args, { encoding: "utf8", env: { ...process.env, ...env } });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  }

  it("pr view --json mergeable answers FAKE_GH_MERGEABLE; FAKE_GH_MERGE_CONFLICT fails pr merge", () => {
    const fake = installFakeGh(7);
    try {
      const view = ["pr", "view", "7", "--json", "mergeable,mergeStateStatus"];
      expect(JSON.parse(gh(view).out)).toEqual({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" });
      expect(JSON.parse(gh(view, { FAKE_GH_MERGEABLE: "UNKNOWN" }).out)).toEqual({
        mergeable: "UNKNOWN",
        mergeStateStatus: "UNKNOWN",
      });
      expect(JSON.parse(gh(view, { FAKE_GH_MERGE_CONFLICT: "1" }).out)).toEqual({
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      });
      // Other pr view calls (files, title, …) print nothing, as before.
      expect(gh(["pr", "view", "7", "--json", "files,title"]).out).toBe("");

      expect(gh(["pr", "merge", "7", "--merge", "--delete-branch"]).code).toBe(0);
      const merge = gh(["pr", "merge", "7", "--merge", "--delete-branch"], { FAKE_GH_MERGE_CONFLICT: "1" });
      expect(merge.code).toBe(1);
      expect(merge.err).toBe("Pull request #7 is not mergeable: the merge commit cannot be cleanly created.");
      expect(fake.calls().filter((c) => c.startsWith("pr view"))).toHaveLength(4);
    } finally {
      fake.restore();
    }
  });
});
