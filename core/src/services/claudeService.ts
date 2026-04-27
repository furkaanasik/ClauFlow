import { spawn } from "node:child_process";

export interface ClaudeRunOptions {
  prompt: string;
  cwd: string;
  allowedTools?: string[];
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
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

function runClaudeOnce(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  // -p must be immediately followed by the prompt string.
  // Other flags come after so the CLI parser picks up the prompt correctly.
  const args = ["-p", options.prompt, "--permission-mode", "bypassPermissions"];
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
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
      if (options.onLine) {
        if (stdoutBuf.length > 0) options.onLine(stdoutBuf, "stdout");
        if (stderrBuf.length > 0) options.onLine(stderrBuf, "stderr");
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
