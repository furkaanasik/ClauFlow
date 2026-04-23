import { spawn } from "node:child_process";

export interface ClaudeRunOptions {
  prompt: string;
  cwd: string;
  allowedTools?: string[];
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  signal?: AbortSignal;
}

export interface ClaudeRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  // -p must be immediately followed by the prompt string.
  // Other flags come after so the CLI parser picks up the prompt correctly.
  const args = ["-p", options.prompt, "--permission-mode", "bypassPermissions"];
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      env: process.env,
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
