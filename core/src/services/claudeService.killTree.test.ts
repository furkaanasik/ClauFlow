import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killLiveGroups, liveProcessGroups, runClaude } from "./claudeService.js";
import { FAKE_CLAUDE, processGone, readHangPids } from "../test-utils/fakeRepo.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await sleep(20);
  }
}

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function useFakeCli(scenario: string): { cwd: string; state: string } {
  const cwd = tmp("clauflow-kill-cwd-");
  const state = tmp("clauflow-kill-state-");
  vi.stubEnv("CLAUFLOW_CLAUDE_BIN", FAKE_CLAUDE);
  vi.stubEnv("FAKE_CLAUDE_STATE", state);
  vi.stubEnv("FAKE_CLAUDE_SCENARIO", scenario);
  return { cwd, state };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("runClaude process tree kill (E7a)", () => {
  it("abort kills a CLI that ignores SIGTERM and its grandchild (SIGKILL after the grace period)", async () => {
    const { cwd, state } = useFakeCli("hang");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "200");
    const controller = new AbortController();
    const started = Date.now();
    const pending = runClaude({ prompt: "hang please", cwd, signal: controller.signal, outputFormat: "stream-json" });

    await until(() => readHangPids(state) !== null);
    const pids = readHangPids(state)!;
    expect(liveProcessGroups()).toContain(pids.cli);
    await sleep(Math.max(0, 200 - (Date.now() - started)));
    expect(processGone(pids.cli)).toBe(false);
    expect(processGone(pids.grandchild)).toBe(false);

    controller.abort();
    const result = await pending;
    expect(result.code).not.toBe(0);
    await until(() => processGone(pids.cli) && processGone(pids.grandchild), 2000);
    expect(liveProcessGroups()).not.toContain(pids.cli);
  });

  it("the slow scenario still exits on SIGTERM, before the grace period", async () => {
    const { cwd } = useFakeCli("slow");
    vi.stubEnv("FAKE_CLAUDE_SLOW_MS", "30000");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "5000");
    const controller = new AbortController();
    const pending = runClaude({ prompt: "slow please", cwd, signal: controller.signal });
    await sleep(300);
    const abortedAt = Date.now();
    controller.abort();
    const result = await pending;
    expect(result.code).toBe(143);
    expect(Date.now() - abortedAt).toBeLessThan(2000);
    expect(liveProcessGroups()).toEqual([]);
  });

  it("killLiveGroups (core shutdown) ends every live CLI tree", async () => {
    const { cwd, state } = useFakeCli("hang");
    const pending = runClaude({ prompt: "hang please", cwd });
    await until(() => readHangPids(state) !== null);
    const pids = readHangPids(state)!;
    expect(liveProcessGroups()).toEqual([pids.cli]);

    killLiveGroups("SIGKILL");
    const result = await pending;
    expect(result.code).not.toBe(0);
    await until(() => processGone(pids.cli) && processGone(pids.grandchild), 2000);
    expect(liveProcessGroups()).toEqual([]);
  });
});
