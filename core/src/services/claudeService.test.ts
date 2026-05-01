import { describe, it, expect, vi } from "vitest";
import { createStreamJsonParser, parseStreamJson } from "./claudeService.js";

function assistantTextEvent(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

function assistantToolUseEvent(id: string, name: string, input: unknown): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

function userToolResultEvent(
  id: string,
  content: unknown,
  isError = false,
): string {
  return JSON.stringify({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: id, content, is_error: isError },
      ],
    },
  });
}

describe("createStreamJsonParser", () => {
  it("reassembles a single event split across multiple feed chunks", () => {
    const onText = vi.fn();
    const parser = createStreamJsonParser({ onText });
    const line = assistantTextEvent("hello world") + "\n";
    const mid = Math.floor(line.length / 2);
    parser.feed(line.slice(0, mid));
    expect(onText).not.toHaveBeenCalled();
    parser.feed(line.slice(mid));
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("hello world");
  });

  it("handles multiple events in a single chunk and preserves order", () => {
    const onText = vi.fn();
    const onToolCallStart = vi.fn();
    const onToolCallEnd = vi.fn();
    const parser = createStreamJsonParser({
      onText,
      onToolCallStart,
      onToolCallEnd,
    });

    const stream =
      assistantTextEvent("first") +
      "\n" +
      assistantToolUseEvent("tool-1", "Bash", { cmd: "ls" }) +
      "\n" +
      userToolResultEvent("tool-1", "file1\nfile2") +
      "\n";
    parser.feed(stream);

    expect(onText).toHaveBeenCalledWith("first");
    expect(onToolCallStart).toHaveBeenCalledTimes(1);
    expect(onToolCallStart.mock.calls[0]![0]).toMatchObject({
      id: "tool-1",
      toolName: "Bash",
      args: { cmd: "ls" },
      status: "running",
      result: null,
    });
    expect(onToolCallEnd).toHaveBeenCalledTimes(1);
    expect(onToolCallEnd.mock.calls[0]![0]).toMatchObject({
      id: "tool-1",
      toolName: "Bash",
      result: "file1\nfile2",
      status: "done",
    });
  });

  it("buffers a partial line until newline is fed, then emits", () => {
    const onText = vi.fn();
    const parser = createStreamJsonParser({ onText });
    const ev = assistantTextEvent("partial-then-complete");

    parser.feed(ev);
    expect(onText).not.toHaveBeenCalled();
    parser.feed("\n");
    expect(onText).toHaveBeenCalledWith("partial-then-complete");
  });

  it("flush() emits a buffered final line that has no trailing newline", () => {
    const onText = vi.fn();
    const parser = createStreamJsonParser({ onText });
    parser.feed(assistantTextEvent("no-newline-end"));
    expect(onText).not.toHaveBeenCalled();
    parser.flush();
    expect(onText).toHaveBeenCalledWith("no-newline-end");
  });

  it("silently ignores malformed JSON lines and keeps processing", () => {
    const onText = vi.fn();
    const onResult = vi.fn();
    const parser = createStreamJsonParser({ onText, onResult });

    parser.feed("this is not json\n");
    parser.feed("{\"type\":\"assistant\",\"message\":{\"content\":[bad}}\n");
    parser.feed(assistantTextEvent("after-malformed") + "\n");
    parser.feed(JSON.stringify({ type: "result", usage: { input_tokens: 1 } }) + "\n");

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("after-malformed");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("marks tool result with is_error: true as status 'error'", () => {
    const onToolCallEnd = vi.fn();
    const parser = createStreamJsonParser({ onToolCallEnd });
    parser.feed(assistantToolUseEvent("t-2", "Read", { path: "/x" }) + "\n");
    parser.feed(userToolResultEvent("t-2", "boom", true) + "\n");
    expect(onToolCallEnd.mock.calls[0]![0]).toMatchObject({
      id: "t-2",
      status: "error",
      result: "boom",
    });
  });

  it("extracts text from array-shaped tool_result content", () => {
    const onToolCallEnd = vi.fn();
    const parser = createStreamJsonParser({ onToolCallEnd });
    parser.feed(assistantToolUseEvent("t-3", "Grep", {}) + "\n");
    parser.feed(
      userToolResultEvent("t-3", [
        { type: "text", text: "line-a" },
        { type: "text", text: "line-b" },
      ]) + "\n",
    );
    expect(onToolCallEnd.mock.calls[0]![0].result).toBe("line-aline-b");
  });

  it("ignores blank lines", () => {
    const onText = vi.fn();
    const parser = createStreamJsonParser({ onText });
    parser.feed("\n\n   \n");
    parser.feed(assistantTextEvent("x") + "\n");
    expect(onText).toHaveBeenCalledTimes(1);
  });
});

describe("parseStreamJson", () => {
  it("collects ended tool calls from a complete stdout buffer", () => {
    const stdout =
      assistantToolUseEvent("a", "Bash", { cmd: "echo hi" }) +
      "\n" +
      userToolResultEvent("a", "hi") +
      "\n";
    const calls = parseStreamJson(stdout);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "a", toolName: "Bash", status: "done" });
  });
});
