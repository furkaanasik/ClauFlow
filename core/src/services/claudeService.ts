import { spawn } from "node:child_process";
import { ADVISOR_SUPPORTED } from "./claudeCapabilities.js";

interface ParsedToolCall {
  id: string;
  toolName: string;
  args: unknown;
  result: string | null;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

interface StreamJsonParserHandlers {
  onText?: (text: string) => void;
  onToolCallStart?: (toolCall: ParsedToolCall) => void;
  onToolCallEnd?: (toolCall: ParsedToolCall) => void;
  onResult?: (raw: unknown) => void;
  onUsage?: (usage: ClaudeUsage) => void;
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
      const message = e.message as { content?: unknown; usage?: unknown } | undefined;
      const usageObj = message?.usage;
      if (usageObj && typeof usageObj === "object") {
        const u = usageObj as Record<string, unknown>;
        const num = (k: string): number => {
          const v = u[k];
          return typeof v === "number" && Number.isFinite(v) ? v : 0;
        };
        handlers.onUsage?.({
          inputTokens: num("input_tokens"),
          outputTokens: num("output_tokens"),
          cacheReadTokens: num("cache_read_input_tokens"),
          cacheWriteTokens: num("cache_creation_input_tokens"),
        });
      }
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
  onUsage?: (usage: ClaudeUsage) => void;
  signal?: AbortSignal;
  outputFormat?: "text" | "json" | "stream-json";
  maxOutputTokens?: number;
  /** Number of automatic retries on transient API errors. Defaults to 2. */
  maxRetries?: number;
  /** Skip project hooks, CLAUDE.md auto-discovery, and LSP. */
  bare?: boolean;
  /** Passed as `--model`. CLI aliases (`sonnet`, `opus`) are accepted. */
  model?: string;
  /** Passed as `--tools`, which restricts the built-in tool set (unlike `--allowedTools`); `[]` disables all tools. */
  tools?: string[];
  appendSystemPrompt?: string;
  /** Passed as `--advisor` only while ADVISOR_SUPPORTED is true. */
  advisorModel?: string | null;
  /** Adds `--strict-mcp-config` so the user's MCP servers are not loaded. */
  strictMcpConfig?: boolean;
  /** Passed as `--setting-sources`, e.g. ["project", "local"] to skip user settings and their hooks/plugins. */
  settingSources?: string[];
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

/**
 * A8e: total argv bytes we allow. Linux caps a single argument at 128 KiB
 * (MAX_ARG_STRLEN); the prompt is one argument, so stay well below that.
 */
export const ARG_BYTES_LIMIT = 100 * 1024;

class PromptTooLargeError extends Error {
  constructor() {
    super("prompt_too_large");
    this.name = "PromptTooLargeError";
  }
}

const PROMPT_BLOCK_RE = /<([a-z][a-z0-9_]*)>\n([\s\S]*?)\n<\/\1>/g;
const MIN_BLOCK_CHARS = 1_000;

function argvBytes(args: string[]): number {
  return args.reduce((n, a) => n + Buffer.byteLength(a, "utf8") + 1, 0);
}

/**
 * Shrinks the largest `<tag>…</tag>` block of `prompt` (repeatedly) until the
 * whole argv fits in `limit` bytes. Throws `prompt_too_large` when no block
 * is left to shrink.
 */
function fitPromptToArgLimit(prompt: string, otherBytes: number, limit = ARG_BYTES_LIMIT): string {
  let p = prompt;
  const over = () => Buffer.byteLength(p, "utf8") + otherBytes - limit;
  for (let guard = 0; guard < 64 && over() > 0; guard++) {
    let best: { start: number; tag: string; body: string } | null = null;
    for (const m of p.matchAll(PROMPT_BLOCK_RE)) {
      const body = m[2]!;
      if (body.length <= MIN_BLOCK_CHARS + 200) continue;
      if (!best || Buffer.byteLength(body, "utf8") > Buffer.byteLength(best.body, "utf8")) {
        best = { start: m.index! + m[1]!.length + 3, tag: m[1]!, body };
      }
    }
    if (!best) break;
    const bodyBytes = Buffer.byteLength(best.body, "utf8");
    const bytesPerChar = bodyBytes / best.body.length;
    const keep = Math.max(MIN_BLOCK_CHARS, Math.floor((bodyBytes - over() - 256) / bytesPerChar));
    const cut = `${best.body.slice(0, keep)}\n[${best.tag} truncated to ${keep} characters to fit the CLI argument limit]`;
    p = p.slice(0, best.start) + cut + p.slice(best.start + best.body.length);
  }
  if (over() > 0) throw new PromptTooLargeError();
  return p;
}

export function buildClaudeArgs(options: ClaudeRunOptions): string[] {
  const args = buildClaudeArgsRaw(options);
  const total = argvBytes(args);
  if (total <= ARG_BYTES_LIMIT) return args;
  const promptBytes = Buffer.byteLength(options.prompt, "utf8") + 1;
  const prompt = fitPromptToArgLimit(options.prompt, total - promptBytes);
  return buildClaudeArgsRaw({ ...options, prompt });
}

function buildClaudeArgsRaw(options: ClaudeRunOptions): string[] {
  // -p must be immediately followed by the prompt string.
  // Other flags come after so the CLI parser picks up the prompt correctly.
  const args = ["-p", options.prompt, "--permission-mode", "bypassPermissions"];
  if (options.bare) args.push("--bare");
  if (options.model) args.push("--model", options.model);
  // An explicit empty list disables every built-in tool (`--tools ""`).
  if (options.tools) args.push("--tools", options.tools.join(","));
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }
  if (options.advisorModel && ADVISOR_SUPPORTED) {
    args.push("--advisor", options.advisorModel);
  }
  if (options.strictMcpConfig) args.push("--strict-mcp-config");
  if (options.settingSources && options.settingSources.length > 0) {
    args.push("--setting-sources", options.settingSources.join(","));
  }
  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
    // claude CLI requires --verbose for stream-json output mode.
    if (options.outputFormat === "stream-json") args.push("--verbose");
  }
  return args;
}

// ── Process tree kill (zincir E7a, plan §3/29) ─────────────────────────────
// Each CLI call runs in its own process group (`detached: true`), so an abort
// reaches the whole tree (tool subprocesses, dev servers) and not only the
// direct child. Live groups are tracked so a core shutdown does not orphan them.

const DEFAULT_KILL_GRACE_MS = 5000;
const liveGroups = new Set<number>();
let shutdownHooked = false;

function killGraceMs(): number {
  const raw = process.env.CLAUFLOW_KILL_GRACE_MS;
  const n = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_KILL_GRACE_MS;
}

function signalGroup(pgid: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, sig);
    return true;
  } catch {
    return false;
  }
}

/** Process groups of CLI calls that have not closed yet (test hook). */
export function liveProcessGroups(): number[] {
  return [...liveGroups];
}

/** Signals every live CLI process group (core shutdown). */
export function killLiveGroups(sig: NodeJS.Signals = "SIGTERM"): void {
  for (const pgid of liveGroups) signalGroup(pgid, sig);
}

function hookShutdown(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  // `exit` runs synchronously: no grace period is possible, so SIGKILL.
  process.once("exit", () => killLiveGroups("SIGKILL"));
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      killLiveGroups("SIGTERM");
      // Alone, this listener would swallow the signal; re-raise the default.
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    });
  }
}

/**
 * SIGTERM to the child's process group, then SIGKILL after `graceMs` if any
 * member is still alive (a CLI that ignores SIGTERM, or a grandchild).
 */
export function killTree(child: { pid?: number }, graceMs = killGraceMs()): void {
  const pgid = child.pid;
  if (!pgid) return;
  if (!signalGroup(pgid, "SIGTERM")) return;
  const timer = setTimeout(() => {
    if (signalGroup(pgid, 0)) signalGroup(pgid, "SIGKILL");
  }, graceMs);
  timer.unref();
}

function runClaudeOnce(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const args = buildClaudeArgs(options);
  const isStreamJson = options.outputFormat === "stream-json";
  const env = { ...process.env };
  if (options.maxOutputTokens && options.maxOutputTokens > 0) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(options.maxOutputTokens);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUFLOW_CLAUDE_BIN || "claude", args, {
      cwd: options.cwd,
      env,
      // stdin'i kapat — "no stdin data received" uyarısını önler
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group: abort kills the whole tree (killTree).
      detached: true,
    });
    const pgid = child.pid;
    if (pgid) {
      hookShutdown();
      liveGroups.add(pgid);
    }

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
          onUsage: (usage) => options.onUsage?.(usage),
        })
      : null;

    const onAbort = () => {
      killTree(child);
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
      if (pgid) liveGroups.delete(pgid);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (pgid) liveGroups.delete(pgid);
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
