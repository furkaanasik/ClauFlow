import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-attsvc-${process.pid}-${Date.now()}`;
});

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  addAttachment,
  attachmentsDir,
  deleteAttachment,
  getAttachment,
  imageInfo,
  linkPendingToComment,
  listAttachments,
  normalizeMime,
  removeTaskAttachmentDir,
  safeName,
  sweepStalePending,
} from "./attachmentService.js";
import { DATA_DIR, createProject, createTask, deleteTask, getTask } from "./taskService.js";
import { makeRepo } from "../test-utils/fakeRepo.js";
import { gifBytes, jpegBytes, pngBytes, pngOfSize, webpBytes, webpVp8Bytes, webpVp8xBytes } from "../test-utils/images.js";

/** bakim #8 (plan §5.6, §3/22–26): attachment validation, limits, drafts and storage. */

const dirs: string[] = [];
let projectId = "";

async function newTask(title = "Task") {
  return createTask({ projectId, title });
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof AttachmentError ? err.code : `other:${(err as Error).message}`;
  }
}

beforeAll(async () => {
  const repo = makeRepo("clauflow-attsvc-");
  dirs.push(repo);
  const p = await createProject({ name: "att", repoPath: repo, defaultBranch: "main", slug: `att${Date.now().toString(36)}` });
  projectId = p.id;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("imageInfo", () => {
  it("reads type and size of png, jpeg, gif and the three webp flavours", () => {
    expect(imageInfo(pngBytes(1, 1))).toEqual({ mime: "image/png", ext: "png", width: 1, height: 1 });
    expect(imageInfo(pngBytes(64, 32))).toEqual({ mime: "image/png", ext: "png", width: 64, height: 32 });
    expect(imageInfo(jpegBytes(1280, 720))).toEqual({ mime: "image/jpeg", ext: "jpg", width: 1280, height: 720 });
    expect(imageInfo(gifBytes(2, 2))).toEqual({ mime: "image/gif", ext: "gif", width: 2, height: 2 });
    expect(imageInfo(webpBytes(5, 4))).toEqual({ mime: "image/webp", ext: "webp", width: 5, height: 4 });
    expect(imageInfo(webpBytes(1000, 3000))).toEqual({ mime: "image/webp", ext: "webp", width: 1000, height: 3000 });
    expect(imageInfo(webpVp8Bytes(7, 6))).toEqual({ mime: "image/webp", ext: "webp", width: 7, height: 6 });
    expect(imageInfo(webpVp8xBytes(300, 200))).toEqual({ mime: "image/webp", ext: "webp", width: 300, height: 200 });
  });

  it("returns null for wrong magic bytes, truncated headers, svg and empty input", () => {
    const fakePng = pngBytes(4, 4);
    fakePng[1] = 0x51; // "PNG" → "QNG"
    expect(imageInfo(fakePng)).toBeNull();
    expect(imageInfo(pngBytes(4, 4).subarray(0, 20))).toBeNull();
    expect(imageInfo(jpegBytes().subarray(0, 12))).toBeNull();
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageInfo(Buffer.from("RIFF\x10\x00\x00\x00WAVEfmt ", "latin1"))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
    expect(imageInfo(Buffer.from("hello world, not an image"))).toBeNull();
  });

  it("normalizeMime and safeName", () => {
    expect(normalizeMime("image/PNG; charset=binary")).toBe("image/png");
    expect(normalizeMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeMime(undefined)).toBeUndefined();
    expect(safeName("../../etc/pass\u0001wd")).toBe("passwd");
    expect(safeName('C:\\Users\\me\\ekran "1".png')).toBe("ekran 1.png");
    expect(safeName("")).toBeNull();
    expect(safeName("a".repeat(300))!.length).toBe(200);
  });
});

describe("addAttachment", () => {
  it("stores the file under DATA_DIR/attachments/<taskId>/ with 0600 and returns the row", async () => {
    const t = await newTask();
    const buf = pngBytes(64, 32);
    const row = addAttachment(t.id, buf, { declaredMime: "image/png", name: "buton.png" });
    expect(row.path).toBe(join(DATA_DIR, "attachments", t.id, `${row.id}.png`));
    expect(attachmentsDir(t.id)).toBe(join(DATA_DIR, "attachments", t.id));
    expect(readFileSync(row.path).equals(buf)).toBe(true);
    expect(statSync(row.path).mode & 0o777).toBe(0o600);
    expect(row).toMatchObject({ mime: "image/png", bytes: buf.length, width: 64, height: 32, name: "buton.png", pending: 0, commentId: null });
    expect(getAttachment(row.id)).toEqual(row);
    const task = await getTask(t.id);
    expect(task!.attachments).toEqual([
      { id: row.id, commentId: null, mime: "image/png", bytes: buf.length, width: 64, height: 32, name: "buton.png", createdAt: row.createdAt },
    ]);
  });

  it("rejects a non-image and a declared type that differs from the sniffed one (attachment_type)", async () => {
    const t = await newTask();
    expect(codeOf(() => addAttachment(t.id, Buffer.from("<svg/>"), { declaredMime: "image/svg+xml" }))).toBe("attachment_type");
    expect(codeOf(() => addAttachment(t.id, pngBytes(), { declaredMime: "image/jpeg" }))).toBe("attachment_type");
    expect(codeOf(() => addAttachment(t.id, jpegBytes(), { declaredMime: "image/jpg" }))).toBeNull();
    expect(codeOf(() => addAttachment(t.id, gifBytes(), {}))).toBeNull();
    expect(listAttachments(t.id).map((r) => r.mime)).toEqual(["image/jpeg", "image/gif"]);
  });

  it("10 MB exactly is accepted, one byte more is attachment_too_large", async () => {
    const t = await newTask();
    expect(codeOf(() => addAttachment(t.id, pngOfSize(MAX_ATTACHMENT_BYTES)))).toBeNull();
    expect(codeOf(() => addAttachment(t.id, pngOfSize(MAX_ATTACHMENT_BYTES + 1)))).toBe("attachment_too_large");
    expect(listAttachments(t.id)).toHaveLength(1);
  });

  it("allows 8 per task, drafts included; the 9th is attachment_limit and writes no file", async () => {
    const t = await newTask();
    for (let i = 0; i < 6; i++) addAttachment(t.id, pngBytes(1, 1));
    addAttachment(t.id, pngBytes(1, 1), { pending: true });
    addAttachment(t.id, pngBytes(1, 1), { pending: true });
    expect(listAttachments(t.id)).toHaveLength(6);
    expect(listAttachments(t.id, { includePending: true })).toHaveLength(8);
    let err: unknown;
    try {
      addAttachment(t.id, pngBytes(1, 1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AttachmentError);
    expect((err as AttachmentError).httpStatus).toBe(409);
    expect((err as AttachmentError).toBody()).toEqual({ error: "attachment_limit", max: 8 });
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(attachmentsDir(t.id))).toHaveLength(8);
    // another task is not affected
    const other = await newTask("Other");
    expect(codeOf(() => addAttachment(other.id, pngBytes()))).toBeNull();
  });

  it("drafts are hidden from the task payload until linked", async () => {
    const t = await newTask();
    const own = addAttachment(t.id, pngBytes());
    const draft = addAttachment(t.id, pngBytes(), { pending: true });
    expect((await getTask(t.id))!.attachments.map((a) => a.id)).toEqual([own.id]);
    linkPendingToComment(t.id, [draft.id], "comment_1");
    const after = (await getTask(t.id))!.attachments;
    expect(after.map((a) => [a.id, a.commentId])).toEqual([
      [own.id, null],
      [draft.id, "comment_1"],
    ]);
  });
});

describe("linkPendingToComment", () => {
  it("rejects another task's draft, a non-draft and an unknown id; nothing changes", async () => {
    const t = await newTask();
    const other = await newTask("Other");
    const mine = addAttachment(t.id, pngBytes(), { pending: true });
    const theirs = addAttachment(other.id, pngBytes(), { pending: true });
    const own = addAttachment(t.id, pngBytes());
    expect(codeOf(() => linkPendingToComment(t.id, [mine.id, theirs.id], "c1"))).toBe("attachment_not_pending");
    expect(codeOf(() => linkPendingToComment(t.id, [mine.id, own.id], "c1"))).toBe("attachment_not_pending");
    expect(codeOf(() => linkPendingToComment(t.id, ["att_nope"], "c1"))).toBe("attachment_not_pending");
    expect(getAttachment(mine.id)!.pending).toBe(1);
    expect(getAttachment(mine.id)!.commentId).toBeNull();
    const linked = linkPendingToComment(t.id, [mine.id, mine.id], "c1");
    expect(linked.map((r) => [r.id, r.commentId, r.pending])).toEqual([[mine.id, "c1", 0]]);
    expect(codeOf(() => linkPendingToComment(t.id, [mine.id], "c2"))).toBe("attachment_not_pending");
  });
});

describe("drafts sweep, delete and task directory", () => {
  it("a draft older than 24 h is swept (row + file) on the next upload; a fresh one stays", async () => {
    const t = await newTask();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T10:00:00.000Z"));
    const old = addAttachment(t.id, pngBytes(), { pending: true });
    vi.setSystemTime(new Date("2026-11-11T09:00:00.000Z"));
    const fresh = addAttachment(t.id, pngBytes(), { pending: true });
    expect(existsSync(old.path)).toBe(true);
    vi.setSystemTime(new Date("2026-11-11T10:00:01.000Z"));
    addAttachment(t.id, pngBytes());
    expect(getAttachment(old.id)).toBeNull();
    expect(existsSync(old.path)).toBe(false);
    expect(getAttachment(fresh.id)).not.toBeNull();
    expect(sweepStalePending(Date.parse("2026-11-12T09:00:01.000Z"))).toBe(1);
    expect(getAttachment(fresh.id)).toBeNull();
  });

  it("deleteAttachment removes row and file; removeTaskAttachmentDir removes the directory", async () => {
    const t = await newTask();
    const a = addAttachment(t.id, pngBytes());
    const b = addAttachment(t.id, webpBytes());
    expect(deleteAttachment(a.id)!.id).toBe(a.id);
    expect(existsSync(a.path)).toBe(false);
    expect(getAttachment(a.id)).toBeNull();
    expect(deleteAttachment(a.id)).toBeNull();
    removeTaskAttachmentDir(t.id);
    expect(existsSync(attachmentsDir(t.id))).toBe(false);
    expect(existsSync(b.path)).toBe(false);
    expect(() => removeTaskAttachmentDir(t.id)).not.toThrow();
  });

  it("deleting the task cascades the rows", async () => {
    const t = await newTask();
    const a = addAttachment(t.id, pngBytes());
    await deleteTask(t.id);
    expect(getAttachment(a.id)).toBeNull();
  });
});
