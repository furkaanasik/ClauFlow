import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs, runClaude } from "./claudeService.js";
import { buildRolePrompt, buildRoleSystemPrompt } from "../agents/teamPrompts.js";
import { defaultRole } from "./teamTemplates.js";

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
    expect(call!.promptSource).toBe("stdin");
  });

  it("a 200 KB task description reaches the CLI intact over stdin", async () => {
    // Multi-byte text, line breaks and argv-hostile characters, well past Linux's 128 KiB MAX_ARG_STRLEN.
    const line = "## Bölüm — çğıöşü \"quotes\" $HOME `tick` --flag\n";
    const description = line.repeat(Math.ceil((200 * 1024) / Buffer.byteLength(line, "utf8")));
    expect(Buffer.byteLength(description, "utf8")).toBeGreaterThan(200 * 1024);
    const role = defaultRole("developer");
    const prompt = buildRolePrompt(role, {
      task: { title: "Design doc", description, analysis: "" },
      project: {},
      round: 1,
      solo: false,
    });
    const result = await runClaude({
      prompt,
      cwd: dir,
      appendSystemPrompt: buildRoleSystemPrompt(role, 1, []).text,
      tools: role.tools,
      outputFormat: "stream-json",
      maxRetries: 0,
    });
    expect(result.code).toBe(0);
    const [call] = readCalls(dir);
    expect(call!.promptSource).toBe("stdin");
    expect(call!.prompt).toBe(prompt);
    expect(call!.prompt as string).toContain(description.trim());
    expect(call!.prompt as string).not.toContain("truncated");
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
    expect(args).toEqual(["-p", "--permission-mode", "bypassPermissions"]);
  });

  it("--add-dir: one flag per directory, right after --permission-mode; -p first, prompt not in argv (bakim #8)", () => {
    const args = buildClaudeArgs({
      prompt: "SECRET PROMPT",
      cwd: dir,
      addDirs: ["/data/attachments/task_1", "/data/attachments/extra"],
      model: "haiku",
      tools: ["Read"],
      strictMcpConfig: true,
      settingSources: ["project", "local"],
      outputFormat: "stream-json",
    });
    expect(args).toEqual([
      "-p",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "/data/attachments/task_1",
      "--add-dir",
      "/data/attachments/extra",
      "--model",
      "haiku",
      "--tools",
      "Read",
      "--strict-mcp-config",
      "--setting-sources",
      "project,local",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(args.join(" ")).not.toContain("SECRET PROMPT");
    expect(buildClaudeArgs({ prompt: "x", cwd: dir, addDirs: [] })).toEqual(["-p", "--permission-mode", "bypassPermissions"]);
  });

  it("runClaude passes addDirs to the CLI; the prompt still arrives on stdin", async () => {
    const result = await runClaude({
      prompt: "look at the image",
      cwd: dir,
      addDirs: [join(dir, "att")],
      outputFormat: "stream-json",
      maxRetries: 0,
    });
    expect(result.code).toBe(0);
    const [call] = readCalls(dir);
    expect(call!.addDirs).toEqual([join(dir, "att")]);
    expect(call!.promptSource).toBe("stdin");
    expect(call!.prompt).toBe("look at the image");
  });

  it("an explicit empty tool list disables every tool (--tools \"\")", () => {
    const args = buildClaudeArgs({ prompt: "x", cwd: dir, tools: [] });
    expect(args).toEqual(["-p", "--permission-mode", "bypassPermissions", "--tools", ""]);
  });
});
