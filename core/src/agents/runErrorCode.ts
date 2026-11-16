/**
 * Maps an executor failure to the code stored in `agent.error` (zincir E2,
 * plan §3/22). The raw output is already in the agent log; the code is what
 * the card and the toast translate. Pure; no I/O.
 */

const PASS_THROUGH = /^(base_branch_missing|role_timeout|gh_missing|git_checkout_failed|git_push_failed|pr_create_failed|claude_exit|run_failed)(:|$)/;

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

export function runErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.name : "";

  if (PASS_THROUGH.test(message)) return message;
  if (name === "GhMissingError" || /spawn gh ENOENT/.test(message)) return "gh_missing";

  const checkout = /^git checkout(?:\/pull| -b) failed:?/.exec(message);
  if (checkout) {
    const detail = firstNonEmptyLine(message.slice(checkout[0].length)).slice(0, 200);
    return detail ? `git_checkout_failed:${detail}` : "git_checkout_failed";
  }
  if (message.startsWith("git push failed")) return "git_push_failed";
  if (message.startsWith("gh pr create failed")) return "pr_create_failed";
  if (message.startsWith("claude CLI exited")) return "claude_exit";

  const flat = message.replace(/\s*\r?\n\s*/g, " ").trim().slice(0, 120);
  return `run_failed:${flat}`;
}
