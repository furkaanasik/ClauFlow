import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FAKE_CLAUDE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));

function run(dir: string, scenario: string, role: string, round: number, extra: string[] = []) {
  const res = spawnSync(
    FAKE_CLAUDE,
    [
      "-p",
      "task",
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
      env: { ...process.env, FAKE_CLAUDE_SCENARIO: scenario, FAKE_CLAUDE_STATE: join(dir, "state") },
    },
  );
  const events = res.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const result = events.find((e) => e.type === "result") as { result?: string } | undefined;
  return { status: res.status, stderr: res.stderr, events, text: result?.result ?? "" };
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
