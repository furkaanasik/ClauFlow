#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Current git branch of `cwd`, or "unknown" outside a repo / on a detached HEAD. */
function currentBranch(cwd) {
  try {
    return execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Paths git reports as unmerged (`--diff-filter=U`) in `cwd`; [] outside a merge. */
function unmergedFiles(cwd) {
  try {
    return execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * zincir F4.6 keep_both: every conflict block becomes "ours lines + theirs
 * lines" (a diff3 base section is dropped). Returns the new text, or null when
 * the text has no complete block.
 */
function keepBothSides(text) {
  const lines = text.split("\n");
  const out = [];
  let state = "outside"; // outside | ours | base | theirs
  let ours = [];
  let theirs = [];
  let blocks = 0;
  for (const line of lines) {
    const bare = line.replace(/\r$/, "");
    if (state === "outside") {
      if (/^<{7}( |$)/.test(bare)) {
        state = "ours";
        ours = [];
        theirs = [];
      } else out.push(line);
    } else if (state === "ours") {
      if (/^\|{7}( |$)/.test(bare)) state = "base";
      else if (/^={7}$/.test(bare)) state = "theirs";
      else ours.push(line);
    } else if (state === "base") {
      if (/^={7}$/.test(bare)) state = "theirs";
    } else if (/^>{7}( |$)/.test(bare)) {
      out.push(...ours, ...theirs);
      blocks++;
      state = "outside";
    } else theirs.push(line);
  }
  return blocks > 0 && state === "outside" ? out.join("\n") : null;
}

/** The conflict_resolver role (zincir F4.6, Z42): resolves (or not) and answers with a resolution note. */
function resolveConflicts(cwd) {
  const mode = process.env.FAKE_CLAUDE_RESOLVE || "keep_both";
  const files = unmergedFiles(cwd);
  if (files.length === 0) return "## Çözüm notu\n\nNo conflicted files found; nothing to resolve.";
  const notes = [];
  for (const rel of files) {
    const file = join(cwd, rel);
    if (mode === "leave_markers" || !existsSync(file)) {
      notes.push(`- ${rel}: left as is`);
      continue;
    }
    const resolved = keepBothSides(readFileSync(file, "utf8"));
    if (resolved === null) {
      notes.push(`- ${rel}: no conflict block found, left as is`);
      continue;
    }
    writeFileSync(file, resolved);
    notes.push(`- ${rel}: both sides changed the same lines; kept ours then theirs`);
  }
  return `## Çözüm notu\n\n${notes.join("\n")}`;
}

/**
 * bakim F1 (#1): FAKE_CLAUDE_RENAME_BASE=<from>:<to> renames the base branch
 * (`git branch -m <from> <to>`); an empty <to> (`main:`) deletes it
 * (`git branch -D <from>`, allowed while the task branch is checked out).
 */
function renameBase(cwd, spec) {
  const i = spec.indexOf(":");
  const from = i === -1 ? spec : spec.slice(0, i);
  const to = i === -1 ? "" : spec.slice(i + 1);
  if (!from) return;
  const args = to ? ["branch", "-m", from, to] : ["branch", "-D", from];
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

/** zincir F4.6: FAKE_CLAUDE_CONFLICT_FILE's first line becomes `line from <branch>`. */
function writeConflictLine(cwd, rel) {
  const file = join(cwd, rel);
  const rest = existsSync(file) ? readFileSync(file, "utf8").split("\n").slice(1) : [""];
  writeFileSync(file, [`line from ${currentBranch(cwd)}`, ...rest].join("\n"));
}

// `-p`/`--print` is a boolean (print mode) like the real CLI; the prompt is the
// first positional argument, or stdin when there is none (what claudeService sends).
const VALUE_FLAGS = new Set([
  "--permission-mode",
  "--model",
  "--tools",
  "--allowedTools",
  "--allowed-tools",
  "--disallowedTools",
  "--append-system-prompt",
  "--system-prompt",
  "--advisor",
  "--output-format",
  "--max-budget-usd",
  "--mcp-config",
  "--fallback-model",
  "--setting-sources",
  "--settings",
]);
// bakim #8: value flags that may repeat; collected into an array.
const REPEAT_FLAGS = new Set(["--add-dir"]);

const MODEL_IDS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-1",
};

const STUCK_BUGS = [
  "1. AC-1 is not met: the function ignores empty input.",
  "2. The test file does not cover the error path.",
];

const ROTATING_BUGS = [
  ["1. Alpha module misses the null guard around parsing.", "2. Bravo helper leaks a file handle."],
  ["1. Charlie route returns the wrong status for duplicates.", "2. Delta cache never expires entries."],
  ["1. Echo validator accepts negative quantities.", "2. Foxtrot logger prints secrets verbatim."],
  ["1. Golf migration forgets the index on email.", "2. Hotel worker swallows timeout exceptions."],
  ["1. India parser breaks on unicode whitespace.", "2. Juliet button lacks a keyboard handler."],
];

function parseArgs(argv) {
  const flags = {};
  const booleans = [];
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REPEAT_FLAGS.has(a)) {
      (flags[a] ??= []).push(argv[i + 1] ?? "");
      i++;
    } else if (VALUE_FLAGS.has(a)) {
      flags[a] = argv[i + 1] ?? "";
      i++;
    } else if (a.startsWith("-")) {
      booleans.push(a);
    } else {
      positionals.push(a);
    }
  }
  return { flags, booleans, positionals };
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function readRole(systemPrompt) {
  const m = /<!--\s*clauflow-role:\s*([a-z_]+)\s+round:\s*(\d+)\s*-->/.exec(systemPrompt ?? "");
  if (!m) return { role: null, round: 0 };
  return { role: m[1], round: Number(m[2]) };
}

function priorCalls(stateDir, role) {
  if (!stateDir) return 0;
  const file = join(stateDir, "calls.jsonl");
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((c) => c && c.role === role).length;
}

function qaReport(scenario, qaIndex) {
  const pass = "## QA raporu\n\n- AC-1: ✓\n\nTests: 1 passed.\n\nVERDICT: PASS";
  const fail = (bugs) =>
    `## QA raporu\n\n- AC-1: ✗\n\nVERDICT: FAIL\n\n## Hata listesi\n\n${bugs.join("\n")}`;
  switch (scenario) {
    case "fail_then_pass":
      return qaIndex === 0 ? fail(STUCK_BUGS) : pass;
    case "stuck":
      return fail(STUCK_BUGS);
    case "always_fail":
      return fail(ROTATING_BUGS[qaIndex % ROTATING_BUGS.length]);
    case "no_verdict":
      return "## QA raporu\n\nSomething looks off but I forgot the verdict line.";
    default:
      return pass;
  }
}

function replyFor(role, round, scenario, cwd, stateDir, prompt) {
  switch (role) {
    case "ceo":
      return "## Brief\n\n### Amaç\nFake goal.\n\n### Kapsam\n- one thing\n\n### Kapsam dışı\n- everything else\n\n### Varsayımlar\n- none";
    case "analyst":
      return "## Şartname\n\n### Ne yapılacak\nFake work.\n\n### Dosyalar\n- fake.txt\n\n### Kabul kriterleri\n- AC-1: fake file exists\n\n### Test önerisi\n- ls";
    case "developer": {
      const name = `fake-${round}.txt`;
      const file = join(cwd, name);
      // no_change: the developer finds nothing to change (executor closes the task as done).
      // zincir Z16: when the file is already there (a chained task branched after its
      // dependency's merge), append a line naming this branch instead of rewriting the
      // same content, so the dependent still has a change of its own.
      if (scenario !== "no_change") {
        if (existsSync(file)) appendFileSync(file, `fake developer output on ${currentBranch(cwd)} round ${round}\n`);
        else writeFileSync(file, `fake developer output round ${round}\n`);
        // zincir F4.6 (Z42): two sibling branches change the same line → a content conflict.
        const conflictFile = process.env.FAKE_CLAUDE_CONFLICT_FILE;
        if (conflictFile) writeConflictLine(cwd, conflictFile);
      }
      // bakim F1 (#1): the base branch disappears mid-run, after the developer wrote its file.
      if (process.env.FAKE_CLAUDE_RENAME_BASE) renameBase(cwd, process.env.FAKE_CLAUDE_RENAME_BASE);
      return `## Teslim notu\n\n- ${name} yazıldı\n- AC-1 → ${name}\n- Tests: 1 passed`;
    }
    case "qa":
      // zincir F4.6: the resolver's QA round fails on demand.
      if (prompt.includes("<conflict_resolution>") && process.env.FAKE_CLAUDE_RESOLVE === "qa_fail") {
        return "## QA raporu\n\n- AC-1: ✗\n\nVERDICT: FAIL\n\n## Hata listesi\n\n1. The conflict resolution dropped one side's intent.";
      }
      return qaReport(scenario, priorCalls(stateDir, "qa"));
    case "conflict_resolver":
      return resolveConflicts(cwd);
    default:
      // Comment runs (no role marker) apply the feedback by touching a file.
      // Planner / breakdown calls (plannerShared.runPlannerCli) get a two-task plan.
      if (prompt.includes("Return ONLY a JSON array")) {
        // zincir F3: plan_deps chains the 2nd and 3rd item to the 1st by key.
        if (scenario === "plan_deps") {
          return JSON.stringify([
            { title: "Fake schema", description: "Base.", analysis: "a", key: "fake-schema", dependsOn: [] },
            { title: "Fake api", description: "Uses the schema.", analysis: "b", key: "fake-api", dependsOn: ["fake-schema"] },
            { title: "Fake docs", description: "Documents the schema.", analysis: "c", key: "fake-docs", dependsOn: ["fake-schema"] },
          ]);
        }
        return JSON.stringify([
          { title: "Fake task one", description: "First.", analysis: "a", priority: "high", tags: ["core"] },
          { title: "Fake task two", description: "Second.", analysis: "b", priority: "low" },
        ]);
      }
      if (prompt.includes("<user_feedback>")) {
        appendFileSync(join(cwd, "fake-comment.txt"), "feedback applied\n");
        return "Feedback applied.";
      }
      return "fake reply";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * bakim #8: the absolute paths listed in the prompt's <attachments> /
 * <feedback_attachments> blocks, each checked from this CLI process (proof the
 * role could read the file): `{ block, path, exists, bytes }`.
 */
function attachmentsSeen(prompt) {
  const out = [];
  for (const block of ["attachments", "feedback_attachments"]) {
    const re = new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "g");
    let m;
    while ((m = re.exec(prompt ?? ""))) {
      for (const line of m[1].split("\n")) {
        const p = /^\s*-\s+(\/\S+)/.exec(line);
        if (!p) continue;
        let bytes = null;
        try {
          bytes = statSync(p[1]).size;
        } catch {
          /* missing */
        }
        out.push({ block, path: p[1], exists: bytes !== null, bytes });
      }
    }
  }
  return out;
}

async function main() {
  const { flags, booleans, positionals } = parseArgs(process.argv.slice(2));
  const promptSource = positionals.length > 0 ? "argv" : "stdin";
  const prompt = positionals.length > 0 ? positionals[0] : await readStdin();
  const systemPrompt = flags["--append-system-prompt"] ?? null;
  const modelArg = flags["--model"] ?? "sonnet";
  const model = MODEL_IDS[modelArg] ?? modelArg;
  const advisorArg = flags["--advisor"] ?? null;
  const outputFormat = flags["--output-format"] ?? "text";
  const scenario = process.env.FAKE_CLAUDE_SCENARIO || "pass";
  const stateDir = process.env.FAKE_CLAUDE_STATE || null;
  const cwd = process.cwd();
  const { role, round } = readRole(systemPrompt);

  const text = replyFor(role, round, scenario, cwd, stateDir, prompt);
  // Lets a test make non-developer roles leave edits behind (teamRunner stashes them).
  if (role && (process.env.FAKE_CLAUDE_DIRTY_ROLES ?? "").split(",").includes(role)) {
    writeFileSync(join(cwd, `scratch-${role}-${round}.txt`), `${role} scribbled in round ${round}\n`);
  }
  // bakim #7: a role "runs npm install" — an untracked node_modules/ appears (shield test).
  if (role && (process.env.FAKE_CLAUDE_NODE_MODULES_ROLES ?? "").split(",").includes(role)) {
    mkdirSync(join(cwd, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(cwd, "node_modules", "pkg", "index.js"), `module.exports = "${role}-${round}";\n`);
  }

  if (stateDir) {
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(
      join(stateDir, "calls.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        cwd,
        role,
        round,
        scenario,
        prompt,
        promptSource,
        model: flags["--model"] ?? null,
        tools: flags["--tools"] ?? null,
        allowedTools: flags["--allowedTools"] ?? null,
        advisor: advisorArg,
        settingSources: flags["--setting-sources"] ?? null,
        addDirs: flags["--add-dir"] ?? null,
        attachmentsSeen: attachmentsSeen(prompt),
        strictMcpConfig: booleans.includes("--strict-mcp-config"),
        appendSystemPrompt: systemPrompt,
        permissionMode: flags["--permission-mode"] ?? null,
        outputFormat,
        booleans,
        argv: process.argv.slice(2),
      }) + "\n",
    );
  }

  // hang (zincir E7a, Z33): the role's work is done (the developer wrote its file),
  // then the CLI ignores SIGTERM, starts a grandchild that holds the output pipes,
  // records both PIDs in FAKE_CLAUDE_STATE/hang-pids.json and never exits.
  if (scenario === "hang") {
    process.on("SIGTERM", () => {});
    const grandchild = spawn(process.execPath, ["-e", "setInterval(()=>{},1e9)"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (stateDir) {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "hang-pids.json"), JSON.stringify({ cli: process.pid, grandchild: grandchild.pid }));
    }
    setInterval(() => {}, 1e9);
    return;
  }

  if (scenario === "slow") {
    process.on("SIGTERM", () => process.exit(143));
    await sleep(Number(process.env.FAKE_CLAUDE_SLOW_MS || 30000));
  }

  // Optional per-call delay so a GUI can watch roles run live (screenshots); off by default.
  const delayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS || 0);
  if (delayMs > 0) await sleep(delayMs);

  if (scenario === "exit_error") {
    process.stderr.write("fake-claude: simulated failure\n");
    process.exit(1);
  }

  const costUsd = Number(process.env.FAKE_CLAUDE_COST_USD || 0.01);
  const usage = {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
  };
  const modelUsage = {
    [model]: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, costUSD: costUsd },
  };
  if (advisorArg) {
    const advisorId = MODEL_IDS[advisorArg] ?? advisorArg;
    modelUsage[advisorId] = { inputTokens: 200, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
  }

  if (outputFormat === "stream-json") {
    const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
    emit({ type: "system", subtype: "init", cwd, model, permissionMode: flags["--permission-mode"] ?? "default", tools: (flags["--tools"] ?? "").split(",").filter(Boolean) });
    // FAKE_CLAUDE_TURN_USAGE="in,out,cacheRead,cacheWrite": per-turn usage that differs from
    // the final `result.usage` (the CLI's per-turn numbers are partial; the result is authoritative).
    const turnRaw = (process.env.FAKE_CLAUDE_TURN_USAGE ?? "").split(",").map(Number);
    const turnUsage = turnRaw.length === 4 && turnRaw.every(Number.isFinite)
      ? { input_tokens: turnRaw[0], output_tokens: turnRaw[1], cache_read_input_tokens: turnRaw[2], cache_creation_input_tokens: turnRaw[3] }
      : usage;
    emit({ type: "assistant", message: { model, content: [{ type: "text", text }], usage: turnUsage } });
    emit({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: costUsd, num_turns: 1, usage, modelUsage });
  } else if (outputFormat === "json") {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: costUsd, usage, modelUsage }) + "\n");
  } else {
    process.stdout.write(text + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`fake-claude crashed: ${err?.stack ?? err}\n`);
  process.exit(2);
});
