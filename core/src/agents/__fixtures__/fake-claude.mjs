#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VALUE_FLAGS = new Set([
  "-p",
  "--print",
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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      flags[a] = argv[i + 1] ?? "";
      i++;
    } else if (a.startsWith("-")) {
      booleans.push(a);
    }
  }
  return { flags, booleans };
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
      // no_change: the developer finds nothing to change (executor closes the task as done).
      if (scenario !== "no_change") writeFileSync(join(cwd, name), `fake developer output round ${round}\n`);
      return `## Teslim notu\n\n- ${name} yazıldı\n- AC-1 → ${name}\n- Tests: 1 passed`;
    }
    case "qa":
      return qaReport(scenario, priorCalls(stateDir, "qa"));
    default:
      // Comment runs (no role marker) apply the feedback by touching a file.
      if (prompt.includes("<user_feedback>")) {
        appendFileSync(join(cwd, "fake-comment.txt"), "feedback applied\n");
        return "Feedback applied.";
      }
      return "fake reply";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { flags, booleans } = parseArgs(process.argv.slice(2));
  const prompt = flags["-p"] ?? flags["--print"] ?? "";
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
        model: flags["--model"] ?? null,
        tools: flags["--tools"] ?? null,
        allowedTools: flags["--allowedTools"] ?? null,
        advisor: advisorArg,
        settingSources: flags["--setting-sources"] ?? null,
        strictMcpConfig: booleans.includes("--strict-mcp-config"),
        appendSystemPrompt: systemPrompt,
        permissionMode: flags["--permission-mode"] ?? null,
        outputFormat,
        booleans,
        argv: process.argv.slice(2),
      }) + "\n",
    );
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
    emit({ type: "assistant", message: { model, content: [{ type: "text", text }], usage } });
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
