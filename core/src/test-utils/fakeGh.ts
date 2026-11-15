import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { git } from "./fakeRepo.js";

/**
 * A `gh` shim put first on PATH: logs every argv line to `log`, answers
 * `pr create` with a PR URL (or fails it when FAKE_GH_CREATE_FAIL is set),
 * and fails `pr merge` when FAKE_GH_MERGE_FAIL is set. No network, no real GitHub.
 */
interface FakeGh {
  dir: string;
  log: string;
  calls: () => string[];
  restore: () => void;
}

export function installFakeGh(prNumber = 7): FakeGh {
  const dir = mkdtempSync(join(tmpdir(), "clauflow-fake-gh-"));
  const log = join(dir, "calls.log");
  const bin = join(dir, "gh");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      `echo "$*" >> "${log}"`,
      'if [ "$1" = "pr" ] && [ "$2" = "create" ] && [ -n "$FAKE_GH_CREATE_FAIL" ]; then',
      '  echo "$FAKE_GH_CREATE_FAIL" >&2',
      "  exit 1",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
      `  echo "https://github.com/acme/fake/pull/${prNumber}"`,
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "merge" ] && [ -n "$FAKE_GH_MERGE_FAIL" ]; then',
      '  echo "$FAKE_GH_MERGE_FAIL" >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  const prevPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}${delimiter}${prevPath}`;
  return {
    dir,
    log,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []),
    restore: () => {
      process.env.PATH = prevPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Bare repo added as `origin` with `main` pushed, so push/pull work offline. */
export function addBareOrigin(repo: string): string {
  const bare = mkdtempSync(join(tmpdir(), "clauflow-origin-"));
  git(bare, "init", "-q", "--bare");
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "-u", "origin", "main");
  return bare;
}
