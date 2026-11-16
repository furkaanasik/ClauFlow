/**
 * Noise-path lists (bakim #6/#7, plan §5.3): the single source for
 *  - the stash "shield" (`gitService.shieldNoiseDirs`): wholly untracked
 *    folders in `SHIELD_DIRS` go to the local `.git/info/exclude` block before
 *    ClauFlow stashes or `git add -A`s, so dependency/build output is never
 *    swept into a stash nor committed;
 *  - the stash detail classification (`classifyPath`, `noiseRoot`);
 *  - the default `.gitignore` a new repo gets (`DEFAULT_GITIGNORE`).
 *
 * Conservative on purpose: anything not recognised is `code`.
 */

export type PathClass = "deps" | "build" | "lock_os" | "code";

/** Dependency folders. `vendor` is display-only (some projects commit it). */
export const DEP_DIRS: readonly string[] = [
  "node_modules",
  "bower_components",
  "jspm_packages",
  ".pnpm-store",
  ".venv",
  "venv",
  "__pycache__",
  "site-packages",
  ".tox",
  ".gradle",
  "Pods",
  ".bundle",
  "vendor",
];

/** Build/test output folders. The last four are display-only (may hold hand-written code). */
export const BUILD_DIRS: readonly string[] = [
  "dist",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  "htmlcov",
  "test-results",
  "playwright-report",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "storybook-static",
  "build",
  "out",
  "target",
  ".cache",
];

/** Build/test output files, matched against the whole path. */
export const BUILD_FILES: readonly RegExp[] = [
  /\.tsbuildinfo$/,
  /(^|\/)junit[^/]*\.xml$/,
  /(^|\/)lcov\.info$/,
  /\.lcov$/,
  /(^|\/)\.coverage$/,
];

/** Lock files and OS litter, matched against the file name. */
export const LOCK_OS_FILES: readonly string[] = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "ehthumbs.db",
];

const LOCK_OS_PATTERNS: readonly RegExp[] = [/\.log$/, /\.sw[po]$/, /~$/];

/** Folders that may hold hand-written code: classified for display, never shielded (§3/11). */
const DISPLAY_ONLY_DIRS: readonly string[] = ["vendor", "build", "out", "target", ".cache"];

/** Folders the shield may exclude locally when they are wholly untracked (§3/10). */
export const SHIELD_DIRS: readonly string[] = DEP_DIRS.filter((d) => !DISPLAY_ONLY_DIRS.includes(d)).concat(
  BUILD_DIRS.filter((d) => !DISPLAY_ONLY_DIRS.includes(d)),
);

const DEP_SET = new Set(DEP_DIRS);
const BUILD_SET = new Set(BUILD_DIRS);
const LOCK_OS_SET = new Set(LOCK_OS_FILES);

/** Folder segments of a repo-relative path (a trailing `/` marks the last one as a folder). */
function dirSegments(p: string): string[] {
  const parts = p.split("/").filter((s) => s.length > 0);
  return p.endsWith("/") ? parts : parts.slice(0, -1);
}

/** The first noise folder segment of `p` with its index, or null. */
function firstNoiseDir(p: string): { index: number; cls: "deps" | "build" } | null {
  const segs = dirSegments(p);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (DEP_SET.has(s)) return { index: i, cls: "deps" };
    if (BUILD_SET.has(s)) return { index: i, cls: "build" };
  }
  return null;
}

/**
 * Class of a repo-relative path: the first dependency/build folder segment
 * decides; otherwise build-output file patterns, then lock/OS file names;
 * everything else is `code`.
 */
export function classifyPath(p: string): PathClass {
  const dir = firstNoiseDir(p);
  if (dir) return dir.cls;
  if (BUILD_FILES.some((re) => re.test(p))) return "build";
  const name = p.replace(/\/+$/, "").split("/").pop() ?? "";
  if (LOCK_OS_SET.has(name) || LOCK_OS_PATTERNS.some((re) => re.test(name))) return "lock_os";
  return "code";
}

/**
 * Prefix of `p` up to and including its first noise folder, plus `/`
 * (`packages/a/node_modules/x/y.js` → `packages/a/node_modules/`), or null.
 */
export function noiseRoot(p: string): string | null {
  const dir = firstNoiseDir(p);
  if (!dir) return null;
  const parts = p.split("/").filter((s) => s.length > 0);
  return `${parts.slice(0, dir.index + 1).join("/")}/`;
}

/** Default `.gitignore` for a new repo or a folder without one (§1 #7a, §3/8). */
export const DEFAULT_GITIGNORE = [
  "# Added by ClauFlow: dependencies, build output, secrets and OS files.",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "out/",
  "coverage/",
  ".env",
  ".env.*",
  "!.env.example",
  ".DS_Store",
  "*.log",
  "__pycache__/",
  ".venv/",
  "",
].join("\n");

/** `DEFAULT_GITIGNORE`'s patterns, without comments and blank lines. */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = DEFAULT_GITIGNORE.split("\n").filter(
  (l) => l.trim() !== "" && !l.startsWith("#"),
);
