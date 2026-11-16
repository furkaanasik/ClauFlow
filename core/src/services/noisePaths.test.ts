import { describe, expect, it } from "vitest";
import {
  BUILD_DIRS,
  DEFAULT_GITIGNORE,
  DEFAULT_IGNORE_PATTERNS,
  DEP_DIRS,
  SHIELD_DIRS,
  classifyPath,
  noiseRoot,
} from "./noisePaths.js";

describe("classifyPath", () => {
  it.each([
    ["node_modules/a/b.js", "deps"],
    ["packages/x/node_modules/y", "deps"],
    ["node_modules/", "deps"],
    [".next/cache/x", "build"],
    ["build/script.sh", "build"],
    ["src/build.ts", "code"],
    ["package-lock.json", "lock_os"],
    ["a/.DS_Store", "lock_os"],
    ["server.log", "lock_os"],
    ["src/app.tsx", "code"],
    ["vendor/x.go", "deps"],
    ["tsconfig.tsbuildinfo", "build"],
    ["reports/junit-results.xml", "build"],
    ["coverage/lcov.info", "build"],
    ["src/.app.ts.swp", "lock_os"],
    ["notes.md", "code"],
    ["node_modules/pkg/dist/index.js", "deps"],
    ["dist/node_modules/x.js", "build"],
  ] as const)("%s → %s", (p, cls) => {
    expect(classifyPath(p)).toBe(cls);
  });
});

describe("noiseRoot", () => {
  it("is the prefix up to the first noise folder", () => {
    expect(noiseRoot("packages/x/node_modules/y")).toBe("packages/x/node_modules/");
    expect(noiseRoot("node_modules/a/b.js")).toBe("node_modules/");
    expect(noiseRoot("node_modules/a/dist/b.js")).toBe("node_modules/");
    expect(noiseRoot(".next/cache/x")).toBe(".next/");
    expect(noiseRoot("build/")).toBe("build/");
  });

  it("is null for code and lock/OS files", () => {
    expect(noiseRoot("src/app.tsx")).toBeNull();
    expect(noiseRoot("src/build.ts")).toBeNull();
    expect(noiseRoot("package-lock.json")).toBeNull();
  });
});

describe("SHIELD_DIRS", () => {
  it("holds the safe dependency/build folders but not the ambiguous ones", () => {
    for (const d of ["node_modules", ".venv", "__pycache__", "dist", ".next", "coverage"]) {
      expect(SHIELD_DIRS).toContain(d);
    }
    for (const d of ["build", "out", "target", ".cache", "vendor"]) {
      expect(SHIELD_DIRS).not.toContain(d);
      expect([...DEP_DIRS, ...BUILD_DIRS]).toContain(d);
    }
  });
});

describe("DEFAULT_GITIGNORE", () => {
  it("lists the §1 patterns and keeps .env.example", () => {
    const lines = DEFAULT_GITIGNORE.split("\n");
    for (const p of [
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
    ]) {
      expect(lines).toContain(p);
      expect(DEFAULT_IGNORE_PATTERNS).toContain(p);
    }
    expect(DEFAULT_GITIGNORE.endsWith("\n")).toBe(true);
    expect(DEFAULT_IGNORE_PATTERNS.some((l) => l.startsWith("#"))).toBe(false);
  });
});
