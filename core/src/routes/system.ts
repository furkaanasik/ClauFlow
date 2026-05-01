import { Router, type Request, type Response } from "express";
import { spawn } from "node:child_process";
import { errorMessage } from "../utils/error.js";

interface PrereqCheck {
  name: string;
  command: string;
  args: string[];
  installCmd: string;
  docsUrl: string;
}

const CHECKS: PrereqCheck[] = [
  {
    name: "claude",
    command: "claude",
    args: ["--version"],
    installCmd: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.claude.com/en/docs/claude-code/quickstart",
  },
  {
    name: "git",
    command: "git",
    args: ["--version"],
    installCmd: "sudo pacman -S git   # or: apt install git / brew install git",
    docsUrl: "https://git-scm.com/downloads",
  },
  {
    name: "gh",
    command: "gh",
    args: ["--version"],
    installCmd: "sudo pacman -S github-cli   # or: brew install gh",
    docsUrl: "https://cli.github.com/",
  },
];

interface PrereqResult {
  name: string;
  found: boolean;
  version: string | null;
  installCmd: string;
  docsUrl: string;
}

function probe(check: PrereqCheck, timeoutMs: number): Promise<PrereqResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (found: boolean, version: string | null) => {
      if (settled) return;
      settled = true;
      resolve({
        name: check.name,
        found,
        version,
        installCmd: check.installCmd,
        docsUrl: check.docsUrl,
      });
    };

    let child;
    try {
      child = spawn(check.command, check.args, { env: process.env });
    } catch {
      finish(false, null);
      return;
    }

    const timer = setTimeout(() => {
      try { child!.kill("SIGKILL"); } catch { /* ignore */ }
      finish(false, null);
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); finish(false, null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = (stdout + "\n" + stderr).trim();
      const firstLine = out.split("\n")[0]?.trim() ?? "";
      finish(code === 0 && firstLine.length > 0, firstLine || null);
    });
  });
}

const router = Router();

router.get("/prereqs", async (_req: Request, res: Response) => {
  try {
    const items = await Promise.all(CHECKS.map((c) => probe(c, 3000)));
    const allOk = items.every((i) => i.found);
    res.json({ allOk, items });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
