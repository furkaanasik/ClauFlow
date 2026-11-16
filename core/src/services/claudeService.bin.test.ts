import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, type ClaudeUsage } from "./claudeService.js";

const FAKE_CLAUDE = fileURLToPath(
  new URL("../agents/__fixtures__/fake-claude.mjs", import.meta.url),
);

describe("runClaude binary override", () => {
  let dir: string;
  const savedBin = process.env.CLAUFLOW_CLAUDE_BIN;
  const savedState = process.env.FAKE_CLAUDE_STATE;
  const savedScenario = process.env.FAKE_CLAUDE_SCENARIO;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clauflow-bin-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("CLAUFLOW_CLAUDE_BIN", savedBin);
    restore("FAKE_CLAUDE_STATE", savedState);
    restore("FAKE_CLAUDE_SCENARIO", savedScenario);
  });

  it("spawns the script named by CLAUFLOW_CLAUDE_BIN with -p first and the prompt on stdin", async () => {
    const script = join(dir, "echo-claude.sh");
    writeFileSync(script, '#!/bin/sh\nprintf "%s\\n" "$@"\nprintf "stdin:"\ncat\n');
    chmodSync(script, 0o755);
    process.env.CLAUFLOW_CLAUDE_BIN = script;

    const result = await runClaude({ prompt: "hello", cwd: dir, maxRetries: 0 });

    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")).toEqual(["-p", "--permission-mode", "bypassPermissions", "stdin:hello"]);
  });

  it("parses the fake CLI's stream-json and logs the call", async () => {
    const state = join(dir, "state");
    process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
    process.env.FAKE_CLAUDE_STATE = state;
    process.env.FAKE_CLAUDE_SCENARIO = "pass";

    const texts: string[] = [];
    const usages: ClaudeUsage[] = [];
    let resultEvent: Record<string, unknown> | null = null;

    const result = await runClaude({
      prompt: "Reply OK",
      cwd: dir,
      outputFormat: "stream-json",
      maxRetries: 0,
      onText: (t) => texts.push(t),
      onUsage: (u) => usages.push(u),
      onResult: (raw) => {
        resultEvent = raw as Record<string, unknown>;
      },
    });

    expect(result.code).toBe(0);
    expect(texts).toEqual(["fake reply"]);
    expect(usages).toEqual([
      { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 },
    ]);
    expect(resultEvent).toMatchObject({ type: "result", result: "fake reply", total_cost_usd: 0.01 });

    const calls = readFileSync(join(state, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      prompt: "Reply OK",
      permissionMode: "bypassPermissions",
      outputFormat: "stream-json",
      scenario: "pass",
      role: null,
    });
  });
});
