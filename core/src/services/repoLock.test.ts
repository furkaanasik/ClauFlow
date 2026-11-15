import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acquireRepoLock,
  getRepoLockHolder,
  getRepoLockQueue,
  tryAcquireRepoLock,
} from "./repoLock.js";

const root = mkdtempSync(join(tmpdir(), "clauflow-repolock-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function dir(): string {
  const d = mkdtempSync(join(root, `r${++n}-`));
  return d;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("repoLock", () => {
  it("serves waiters FIFO", async () => {
    const repo = dir();
    const order: string[] = [];
    const first = await acquireRepoLock(repo, { owner: "a" });
    const pending = ["b", "c", "d"].map((o) =>
      acquireRepoLock(repo, { owner: o }).then((lease) => {
        order.push(o);
        return lease;
      }),
    );
    await tick();
    expect(order).toEqual([]);
    expect(getRepoLockQueue(repo)).toEqual(["b", "c", "d"]);
    first.release();
    for (const p of pending) (await p).release();
    expect(order).toEqual(["b", "c", "d"]);
    expect(getRepoLockHolder(repo)).toBeNull();
  });

  it("two different repos lock independently", async () => {
    const a = await acquireRepoLock(dir(), { owner: "a" });
    const b = await Promise.race([
      acquireRepoLock(dir(), { owner: "b" }),
      new Promise<null>((r) => setTimeout(() => r(null), 50)),
    ]);
    expect(b).not.toBeNull();
    a.release();
    b!.release();
  });

  it("two aliases (symlink) of one repo share the lock", async () => {
    const repo = dir();
    const alias = join(root, `alias-${n}`);
    symlinkSync(repo, alias);
    const lease = await acquireRepoLock(repo, { owner: "real" });
    expect(tryAcquireRepoLock(alias, "alias")).toBeNull();
    expect(getRepoLockHolder(alias)).toMatchObject({ owner: "real" });
    lease.release();
    const second = tryAcquireRepoLock(alias, "alias");
    expect(second).not.toBeNull();
    second!.release();
  });

  it("aborting a waiter removes it from the queue and rejects with AbortError", async () => {
    const repo = dir();
    const first = await acquireRepoLock(repo, { owner: "a" });
    const ctrl = new AbortController();
    const waiting = acquireRepoLock(repo, { owner: "b", signal: ctrl.signal });
    const third = acquireRepoLock(repo, { owner: "c" });
    await tick();
    ctrl.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(getRepoLockQueue(repo)).toEqual(["c"]);
    first.release();
    const lease = await third;
    expect(lease.owner).toBe("c");
    lease.release();
  });

  it("an already aborted signal rejects immediately", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(acquireRepoLock(dir(), { owner: "x", signal: ctrl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("release is idempotent and a stale lease cannot release a newer holder", async () => {
    const repo = dir();
    const first = await acquireRepoLock(repo, { owner: "a" });
    const secondP = acquireRepoLock(repo, { owner: "b" });
    first.release();
    const second = await secondP;
    first.release();
    expect(getRepoLockHolder(repo)).toMatchObject({ owner: "b" });
    second.release();
    second.release();
    expect(getRepoLockHolder(repo)).toBeNull();
  });

  it("tryAcquire returns null while held or while someone is queued", async () => {
    const repo = dir();
    const held = tryAcquireRepoLock(repo, "a");
    expect(held).not.toBeNull();
    expect(tryAcquireRepoLock(repo, "b")).toBeNull();
    const queued = acquireRepoLock(repo, { owner: "c" });
    held!.release();
    const c = await queued;
    expect(tryAcquireRepoLock(repo, "d")).toBeNull();
    c.release();
    expect(tryAcquireRepoLock(repo, "d")).not.toBeNull();
  });
});
