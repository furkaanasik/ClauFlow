import { Router, type Request, type Response } from "express";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { run } from "../services/gitService.js";
import { errorMessage } from "../utils/error.js";

const router = Router();

interface GhLoginSession {
  child: ChildProcessWithoutNullStreams | null;
  userCode: string | null;
  verificationUri: string | null;
  connected: boolean;
  user: string | null;
  error: string | null;
  stderrBuffer: string;
  enterSent: boolean;
  finished: boolean;
}

let session: GhLoginSession | null = null;

function resetSession(): void {
  if (session?.child && !session.finished) {
    try {
      session.child.kill();
    } catch {
      // ignore
    }
  }
  session = null;
}

async function getGhUser(): Promise<string | null> {
  const result = await run("gh", ["api", "user", "--jq", ".login"], process.cwd());
  if (result.code !== 0) return null;
  const user = result.stdout.trim();
  return user.length > 0 ? user : null;
}

async function checkExistingGhAuth(): Promise<string | null> {
  const result = await run("gh", ["auth", "status"], process.cwd());
  const combined = `${result.stdout}\n${result.stderr}`;
  if (!/Logged in to github\.com/i.test(combined)) return null;
  return await getGhUser();
}

function parseDeviceInfo(buffer: string): {
  userCode: string | null;
  verificationUri: string | null;
} {
  let userCode: string | null = null;
  let verificationUri: string | null = null;

  // Match "one-time code: XXXX-XXXX" or "Enter code: XXXX-XXXX"
  const codeMatch =
    buffer.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i) ||
    buffer.match(/Enter code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i) ||
    buffer.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
  if (codeMatch && codeMatch[1]) {
    userCode = codeMatch[1];
  }

  // Match verification URI
  const uriMatch =
    buffer.match(
      /Open this URL to continue in your web browser:\s*(https?:\/\/\S+)/i,
    ) ||
    buffer.match(/(https?:\/\/github\.com\/login\/device\S*)/i);
  if (uriMatch && uriMatch[1]) {
    verificationUri = uriMatch[1];
  } else if (userCode) {
    // Default fallback when gh only prints code and asks to press Enter
    verificationUri = "https://github.com/login/device";
  }

  return { userCode, verificationUri };
}

function waitForDeviceInfo(
  current: GhLoginSession,
  timeoutMs: number,
): Promise<{ userCode: string; verificationUri: string }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams | null = current.child;
    if (!child) {
      reject(new Error("gh process not started"));
      return;
    }
    const proc: ChildProcessWithoutNullStreams = child;

    const cleanup = (): void => {
      clearTimeout(timer);
      proc.stderr.off("data", onData);
      proc.off("error", onError);
      proc.off("close", onClose);
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      current.stderrBuffer += text;
      const parsed = parseDeviceInfo(current.stderrBuffer);
      if (parsed.userCode && parsed.verificationUri) {
        current.userCode = parsed.userCode;
        current.verificationUri = parsed.verificationUri;

        // Send Enter to skip "Press Enter to open browser" prompt
        if (!current.enterSent) {
          try {
            proc.stdin.write("\n");
            current.enterSent = true;
          } catch {
            // ignore write errors
          }
        }

        cleanup();
        resolve({
          userCode: parsed.userCode,
          verificationUri: parsed.verificationUri,
        });
      }
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    const onClose = (code: number | null): void => {
      cleanup();
      reject(new Error(`gh exited early with code ${code ?? -1}`));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout_waiting_for_device_code"));
    }, timeoutMs);

    proc.stderr.on("data", onData);
    proc.on("error", onError);
    proc.on("close", onClose);
  });
}

function attachLifecycleHandlers(current: GhLoginSession): void {
  const child = current.child;
  if (!child) return;

  child.stderr.on("data", (chunk: Buffer) => {
    current.stderrBuffer += chunk.toString("utf8");
  });

  child.on("error", (err: Error) => {
    current.error = `gh_spawn_error: ${err.message}`;
    current.finished = true;
  });

  child.on("close", (code: number | null) => {
    current.finished = true;
    if (code === 0) {
      void run("gh", ["auth", "setup-git"], process.cwd()).then(() =>
        getGhUser().then((user) => {
          if (session === current) {
            current.user = user;
            current.connected = true;
          }
        }),
      );
    } else {
      const detail = current.stderrBuffer.trim().slice(-500);
      current.error = `gh_auth_login_failed(code=${code ?? -1}): ${detail}`;
    }
  });
}

router.post("/github/start", async (_req: Request, res: Response) => {
  try {
    resetSession();

    const child = spawn(
      "gh",
      [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--scopes",
        "repo,read:user",
      ],
      {
        env: { ...process.env, GH_PROMPT_DISABLED: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    ) as ChildProcessWithoutNullStreams;

    const current: GhLoginSession = {
      child,
      userCode: null,
      verificationUri: null,
      connected: false,
      user: null,
      error: null,
      stderrBuffer: "",
      enterSent: false,
      finished: false,
    };
    session = current;

    const info = await waitForDeviceInfo(current, 20_000);

    // Re-attach long-lived listeners for the remainder of the process lifetime
    attachLifecycleHandlers(current);

    res.json({
      userCode: info.userCode,
      verificationUri: info.verificationUri,
    });
  } catch (err) {
    if (session?.child && !session.finished) {
      try {
        session.child.kill();
      } catch {
        // ignore
      }
    }
    session = null;
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/github/status", async (_req: Request, res: Response) => {
  try {
    if (!session || (!session.connected && !session.error && !session.finished)) {
      if (!session) {
        const existingUser = await checkExistingGhAuth();
        if (existingUser) {
          res.json({
            connected: true,
            user: existingUser,
            userCode: null,
            verificationUri: null,
            error: null,
          });
          return;
        }
      }
    }

    if (!session) {
      res.json({
        connected: false,
        user: null,
        userCode: null,
        verificationUri: null,
        error: null,
      });
      return;
    }

    // Process finished successfully but user hasn't been resolved yet
    if (session.finished && !session.error && !session.connected) {
      const user = await getGhUser();
      if (user) {
        session.user = user;
        session.connected = true;
      }
    }

    res.json({
      connected: session.connected,
      user: session.user,
      userCode: session.connected ? null : session.userCode,
      verificationUri: session.connected ? null : session.verificationUri,
      error: session.error,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
