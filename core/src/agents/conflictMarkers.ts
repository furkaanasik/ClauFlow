/**
 * Pure helpers of the conflict resolver (zincir F4.6, plan §3/37–38, Z41, Z43).
 * No I/O: the resolver reads files and runs git, these only parse text.
 */

export type ConflictMarkerKind = "start" | "base" | "sep" | "end";

export interface ConflictMarker {
  /** 1-based line number. */
  line: number;
  kind: ConflictMarkerKind;
}

const START = /^<{7}( |$)/;
const BASE = /^\|{7}( |$)/; // diff3 / zdiff3 "common ancestor" section
const END = /^>{7}( |$)/;
const SEP = /^={7}$/;

/**
 * Conflict markers git leaves in a file. `<<<<<<<`, `|||||||` and `>>>>>>>`
 * count wherever they start a line (followed by a space or the line end);
 * a bare `=======` counts only inside an open `<<<<<<<` block, so a Markdown
 * setext heading underline is not a false alarm (Z43). A marker that does not
 * start the line (e.g. inside a string literal) is not one.
 */
export function findConflictMarkers(text: string): ConflictMarker[] {
  const found: ConflictMarker[] = [];
  let open = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    if (START.test(line)) {
      found.push({ line: i + 1, kind: "start" });
      open = true;
    } else if (BASE.test(line)) {
      found.push({ line: i + 1, kind: "base" });
    } else if (END.test(line)) {
      found.push({ line: i + 1, kind: "end" });
      open = false;
    } else if (open && SEP.test(line)) {
      found.push({ line: i + 1, kind: "sep" });
    }
  }
  return found;
}

/**
 * The `leftover conflict marker` lines of `git diff --check` output. The
 * command also exits non-zero for whitespace problems (trailing whitespace,
 * space before tab, …), which are not conflicts and are dropped (Z43).
 */
export function parseDiffCheck(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((l) => /^\S.*:\d+: leftover conflict marker$/.test(l));
}

export interface MergeSubject {
  displayId?: string;
  prNumber?: number;
  branch?: string;
}

/**
 * What a merge commit's subject says about the work it brought in (§3/37):
 * - ClauFlow local merge `Merge <branch> (<displayId>)` (mergeService);
 * - GitHub PR merge `Merge pull request #<n> from <owner>/<branch>`;
 * - ClauFlow resolver `Merge <target> into <branch> (<displayId>): conflicts resolved by ClauFlow`;
 * - plain git `Merge branch '<src>'[ into <dst>]` and
 *   `Merge remote-tracking branch '<remote>/<src>'[ into <dst>]` → `{ branch: <src> }`,
 *   the side that was brought in (decision F4.6 §10: `Merge branch 'main' into x`
 *   gives `{ branch: "main" }`; the caller maps branches to tasks and a base
 *   branch simply matches none).
 * Anything else → null.
 */
export function parseMergeSubject(subject: string): MergeSubject | null {
  const s = subject.trim();

  const pr = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)$/.exec(s);
  if (pr) return { prNumber: Number(pr[1]), branch: pr[2]! };

  const resolved = /^Merge \S+ into (\S+) \(([^()\s]+)\): conflicts resolved by ClauFlow$/.exec(s);
  if (resolved) return { displayId: resolved[2]!, branch: resolved[1]! };

  const remote = /^Merge remote-tracking branch '[^/'\s]+\/([^'\s]+)'(?: into \S+)?$/.exec(s);
  if (remote) return { branch: remote[1]! };

  const plain = /^Merge branch '([^'\s]+)'(?: of \S+)?(?: into \S+)?$/.exec(s);
  if (plain) return { branch: plain[1]! };

  const local = /^Merge (\S+) \(([^()\s]+)\)$/.exec(s);
  if (local) return { displayId: local[2]!, branch: local[1]! };

  return null;
}
