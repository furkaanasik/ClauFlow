import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs, runClaude } from "./claudeService.js";

const FAKE_CLAUDE = fileURLToPath(
  new URL("../agents/__fixtures__/fake-claude.mjs", import.meta.url),
);

function readCalls(dir: string): Array<Record<string, unknown>> {
  return readFileSync(join(dir, "state", "calls.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("runClaude role options", () => {
  let dir: string;
  const saved = {
    bin: process.env.CLAUFLOW_CLAUDE_BIN,
    state: process.env.FAKE_CLAUDE_STATE,
    scenario: process.env.FAKE_CLAUDE_SCENARIO,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clauflow-role-args-"));
    process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
    process.env.FAKE_CLAUDE_STATE = join(dir, "state");
    process.env.FAKE_CLAUDE_SCENARIO = "pass";
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("CLAUFLOW_CLAUDE_BIN", saved.bin);
    restore("FAKE_CLAUDE_STATE", saved.state);
    restore("FAKE_CLAUDE_SCENARIO", saved.scenario);
  });

  it("passes model, tools, system prompt, advisor and isolation flags", async () => {
    const result = await runClaude({
      prompt: "do the thing",
      cwd: dir,
      model: "sonnet",
      tools: ["Read", "Bash", "Glob", "Grep"],
      appendSystemPrompt: "<!-- clauflow-role: qa round: 2 -->\nYou are QA.",
      advisorModel: "opus",
      strictMcpConfig: true,
      settingSources: ["project", "local"],
      outputFormat: "stream-json",
      maxRetries: 0,
    });
    expect(result.code).toBe(0);
    const [call] = readCalls(dir);
    expect(call).toMatchObject({
      role: "qa",
      round: 2,
      prompt: "do the thing",
      model: "sonnet",
      tools: "Read,Bash,Glob,Grep",
      advisor: "opus",
      settingSources: "project,local",
      strictMcpConfig: true,
      permissionMode: "bypassPermissions",
      outputFormat: "stream-json",
    });
    expect(call!.appendSystemPrompt).toContain("You are QA.");
    expect((call!.argv as string[])[0]).toBe("-p");
  });

  it("leaves legacy callers' arguments unchanged", () => {
    const args = buildClaudeArgs({
      prompt: "legacy",
      cwd: dir,
      allowedTools: ["Read", "Write"],
      outputFormat: "stream-json",
    });
    expect(args).toEqual([
      "-p",
      "legacy",
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "Read,Write",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("omits optional role flags when not given", () => {
    const args = buildClaudeArgs({ prompt: "x", cwd: dir, advisorModel: null });
    expect(args).toEqual(["-p", "x", "--permission-mode", "bypassPermissions"]);
  });

  it("an explicit empty tool list disables every tool (--tools \"\")", () => {
    const args = buildClaudeArgs({ prompt: "x", cwd: dir, tools: [] });
    expect(args).toEqual(["-p", "x", "--permission-mode", "bypassPermissions", "--tools", ""]);
  });
});
