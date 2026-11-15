import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The inverse of `installFakeGh` (zincir E1, plan §6): PATH becomes a temp dir
 * holding only `git` and `node` symlinks, so spawning `gh` fails with ENOENT.
 * `node` stays reachable for the fake CLI's `#!/usr/bin/env node` shebang.
 * Returns the restore function.
 */
export function withoutGh(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "clauflow-nogh-"));
  const gitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  symlinkSync(gitBin, join(dir, "git"));
  symlinkSync(process.execPath, join(dir, "node"));
  const prevPath = process.env.PATH;
  process.env.PATH = dir;
  return () => {
    process.env.PATH = prevPath;
    rmSync(dir, { recursive: true, force: true });
  };
}
