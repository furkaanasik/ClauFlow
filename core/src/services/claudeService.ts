import { spawn } from "node:child_process";

export interface ParsedToolCall {
  id: string;
  toolName: string;
  args: unknown;
  result: string | null;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface StreamJsonParserHandlers {
  onText?: (text: string) => void;
  onToolCallStart?: (toolCall: ParsedToolCall) => void;
  onToolCallEnd?: (toolCall: ParsedToolCall) => void;
  onResult?: (raw: unknown) => void;
}

interface InFlightToolCall {
  toolName: string;
  args: unknown;
  startedAt: string;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === "object" && "text" in c) {
          const t = (c as { text?: unknown }).text;
          if (typeof t === "string") return t;
        }
        return JSON.stringify(c);
      })
      .join("");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

export function createStreamJsonParser(handlers: StreamJsonParserHandlers = {}) {
  let buffer = "";
  const inFlight = new Map<string, InFlightToolCall>();

  function processLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) return;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    if (!evt || typeof evt !== "object") return;
    const e = evt as Record<string, unknown>;

    if (e.type === "assistant") {
      const message = e.message as { content?: unknown } | undefined;
      const items = Array.isArray(message?.content) ? message!.content : [];
      for (const item of items as Array<Record<string, unknown>>) {
        if (!item || typeof item !== "object") continue;
        if (item.type === "text" && typeof item.text === "string") {
          handlers.onText?.(item.text);
        } else if (item.type === "tool_use" && typeof item.id === "string") {
          const startedAt = new Date().toISOString();
          const toolName = typeof item.name === "string" ? item.name : "unknown";
          inFlight.set(item.id, { startedAt, args: item.input, toolName });
          handlers.onToolCallStart?.({
            id: item.id,
            toolName,
            args: item.input,
            result: null,
            status: "running",
            startedAt,
            finishedAt: null,
            durationMs: null,
          });
        }
      }
      return;
    }

    if (e.type === "user") {
      const message = e.message as { content?: unknown } | undefined;
      const items = Array.isArray(message?.content) ? message!.content : [];
      for (const item of items as Array<Record<string, unknown>>) {
        if (!item || typeof item !== "object") continue;
        if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
          const start = inFlight.get(item.tool_use_id);
          inFlight.delete(item.tool_use_id);
          const finishedAt = new Date().toISOString();
          const startedAt = start?.startedAt ?? finishedAt;
          const durationMs = Math.max(
            0,
            Date.parse(finishedAt) - Date.parse(startedAt),
          );
          const isError = item.is_error === true;
          handlers.onToolCallEnd?.({
            id: item.tool_use_id,
            toolName: start?.toolName ?? "unknown",
            args: start?.args,
            result: extractToolResultText(item.content),
            status: isError ? "error" : "done",
            startedAt,
            finishedAt,
            durationMs,
          });
        }
      }
      return;
    }

    if (e.type === "result") {
      handlers.onResult?.(evt);
    }
  }

  return {
    feed(chunk: string): void {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line);
      }
    },
    flush(): void {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = "";
      }
    },
  };
}

export function parseStreamJson(stdout: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const parser = createStreamJsonParser({
    onToolCallEnd: (tc) => calls.push(tc),
  });
  parser.feed(stdout);
  parser.flush();
  return calls;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Best-effort extraction of token usage from a stream-json `result` event.
 * The CLI emits a final event roughly shaped like:
 *   { type: "result", usage: { input_tokens, output_tokens,
 *     cache_read_input_tokens, cache_creation_input_tokens } }
 * Some CLI versions nest the block under `result.usage` instead; we check
 * both. Missing or non-numeric fields fall back to 0 so callers can safely
 * accumulate.
 */
export function parseUsageFromResult(raw: unknown): ClaudeUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    r.usage,
    typeof r.result === "object" && r.result !== null
      ? (r.result as Record<string, unknown>).usage
      : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const u = candidate as Record<string, unknown>;
    const num = (k: string): number => {
      const v = u[k];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    const usage: ClaudeUsage = {
      inputTokens: num("input_tokens"),
      outputTokens: num("output_tokens"),
      cacheReadTokens: num("cache_read_input_tokens"),
      cacheWriteTokens: num("cache_creation_input_tokens"),
    };
    // Only return if at least one field is non-zero — guards against
    // empty objects that happen to satisfy the shape check.
    const total =
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheReadTokens +
      usage.cacheWriteTokens;
    if (total > 0) return usage;
    return usage;
  }
  return null;
}

export interface ClaudeRunOptions {
  prompt: string;
  cwd: string;
  allowedTools?: string[];
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  onText?: (text: string) => void;
  onToolCallStart?: (toolCall: ParsedToolCall) => void;
  onToolCallEnd?: (toolCall: ParsedToolCall) => void;
  /** Fired once with the final stream-json `result` event. */
  onResult?: (raw: unknown) => void;
  signal?: AbortSignal;
  outputFormat?: "text" | "json" | "stream-json";
  maxOutputTokens?: number;
  /** Number of automatic retries on transient API errors. Defaults to 2. */
  maxRetries?: number;
}

export interface ClaudeRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const TRANSIENT_PATTERNS: RegExp[] = [
  /Stream idle timeout/i,
  /partial response received/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /fetch failed/i,
  /503 Service Unavailable/i,
  /529 Overloaded/i,
];

function isTransientFailure(result: ClaudeRunResult): boolean {
  if (result.code === 0) return false;
  const haystack = `${result.stderr}\n${result.stdout}`;
  return TRANSIENT_PATTERNS.some((p) => p.test(haystack));
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const maxRetries = options.maxRetries ?? 2;
  let lastResult: ClaudeRunResult | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(2000 * 2 ** (attempt - 1), 8000);
      options.onLine?.(
        `[retry] transient claude failure — attempt ${attempt + 1}/${maxRetries + 1} after ${delayMs}ms`,
        "stderr",
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const result = await runClaudeOnce(options);
    lastResult = result;
    if (result.code === 0) return result;
    if (!isTransientFailure(result)) return result;
    if (options.signal?.aborted) return result;
  }
  return lastResult!;
}

function emitText(
  options: ClaudeRunOptions,
  text: string,
  stream: "stdout" | "stderr" = "stdout",
): void {
  options.onText?.(text);
  if (options.onLine) {
    for (const ln of text.split(/\r?\n/)) {
      if (ln.length > 0) options.onLine(ln, stream);
    }
  }
}

function runClaudeOnce(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  // -p must be immediately followed by the prompt string.
  // Other flags come after so the CLI parser picks up the prompt correctly.
  const args = ["-p", options.prompt, "--permission-mode", "bypassPermissions"];
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  const isStreamJson = options.outputFormat === "stream-json";
  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
    // claude CLI requires --verbose for stream-json output mode.
    if (isStreamJson) args.push("--verbose");
  }
  const env = { ...process.env };
  if (options.maxOutputTokens && options.maxOutputTokens > 0) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(options.maxOutputTokens);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      env,
      // stdin'i kapat — "no stdin data received" uyarısını önler
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuf = "";
    let stderrBuf = "";

    const streamParser = isStreamJson
      ? createStreamJsonParser({
          onText: (text) => emitText(options, text, "stdout"),
          onToolCallStart: (tc) => options.onToolCallStart?.(tc),
          onToolCallEnd: (tc) => options.onToolCallEnd?.(tc),
          onResult: (raw) => options.onResult?.(raw),
        })
      : null;

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (streamParser) {
        streamParser.feed(text);
        return;
      }
      if (!options.onLine) return;
      stdoutBuf += text;
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        options.onLine(line, "stdout");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (!options.onLine) return;
      stderrBuf += text;
      let nl: number;
      while ((nl = stderrBuf.indexOf("\n")) !== -1) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        options.onLine(line, "stderr");
      }
    });

    child.on("error", (err) => {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      if (streamParser) streamParser.flush();
      if (options.onLine) {
        if (stdoutBuf.length > 0 && !streamParser)
          options.onLine(stdoutBuf, "stdout");
        if (stderrBuf.length > 0) options.onLine(stderrBuf, "stderr");
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
