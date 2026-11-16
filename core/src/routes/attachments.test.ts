import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-attroutes-${process.pid}-${Date.now()}`;
});

vi.mock("../agents/executor.js", () => ({
  enqueue: () => {},
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

// The comment runner records what the DB said about the comment's images at
// the moment it was started (§3/26: linking must happen first).
const runner = vi.hoisted(() => ({ seen: [] as Array<{ commentId: string; linked: Array<[string, string | null, number]> }> }));
vi.mock("../agents/commentRunner.js", async () => {
  const { db } = await import("../services/taskService.js");
  return {
    runComment: async (comment: { id: string; taskId: string }) => {
      const rows = db
        .prepare(`SELECT id, commentId, pending FROM task_attachments WHERE taskId = ? ORDER BY rowid`)
        .all(comment.taskId) as { id: string; commentId: string | null; pending: number }[];
      runner.seen.push({ commentId: comment.id, linked: rows.map((r) => [r.id, r.commentId, r.pending]) });
    },
  };
});

const ws = vi.hoisted(() => ({ updated: [] as string[] }));
vi.mock("../services/wsService.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/wsService.js")>();
  return {
    ...orig,
    broadcastTaskUpdated: (task: { id: string }) => {
      ws.updated.push(task.id);
    },
    broadcastTaskDeleted: () => {},
  };
});

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createProject, createTask, DATA_DIR, getTask, listTasks, updateTask } from "../services/taskService.js";
import { attachmentsDir, getAttachment } from "../services/attachmentService.js";
import { makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import { jpegBytes, pngBytes, pngOfSize } from "../test-utils/images.js";
import tasksRouter from "./tasks.js";
import commentsRouter from "./comments.js";
import attachmentsRouter from "./attachments.js";
import projectsRouter from "./projects.js";

/** bakim #8 (plan §5.6, §3/23–33): upload, serve, delete, comment drafts, cleanup on delete. */

let server: TestServer;
const dirs: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function upload(taskId: string, buf: Buffer, opts: { type?: string; query?: string } = {}) {
  const res = await fetch(`${server.url}/api/tasks/${taskId}/attachments${opts.query ? `?${opts.query}` : ""}`, {
    method: "POST",
    headers: { "content-type": opts.type ?? "image/png" },
    body: buf,
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function setup(status: "todo" | "review" | "doing" = "todo", branch: string | null = null) {
  const repo = makeRepo("clauflow-attroutes-");
  dirs.push(repo);
  const project = await createProject({
    name: `ar ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `ar${dirs.length}${Date.now().toString(36)}`,
  });
  const task = await createTask({ projectId: project.id, title: "Butonu bu görseldeki gibi yap" });
  if (status !== "todo" || branch) await updateTask(task.id, { status, branch });
  return { repo, project, task };
}

beforeAll(async () => {
  server = await startTestServer([
    ["/api/tasks", tasksRouter],
    ["/api/tasks/:id/comments", commentsRouter],
    ["/api/attachments", attachmentsRouter],
    ["/api/projects", projectsRouter],
  ]);
});

beforeEach(() => {
  ws.updated.length = 0;
  runner.seen.length = 0;
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("POST /api/tasks/:id/attachments", () => {
  it("201 with the meta (no path), file on disk, task payload and task_updated", async () => {
    const { task } = await setup();
    const buf = pngBytes(64, 32);
    const r = await upload(task.id, buf, { query: "name=buton%20%C3%B6rnek.png" });
    expect(r.status).toBe(201);
    const a = r.json.attachment;
    expect(a).toMatchObject({ mime: "image/png", bytes: buf.length, width: 64, height: 32, name: "buton örnek.png", commentId: null, pending: false });
    expect(a.path).toBeUndefined();
    const row = getAttachment(a.id)!;
    expect(row.path.startsWith(join(DATA_DIR, "attachments", task.id))).toBe(true);
    expect(readFileSync(row.path).equals(buf)).toBe(true);
    expect((await getTask(task.id))!.attachments.map((x) => x.id)).toEqual([a.id]);
    expect(ws.updated).toEqual([task.id]);
    const listed = (await listTasks(task.projectId)).find((t) => t.id === task.id)!;
    expect(listed.attachments.map((x) => x.id)).toEqual([a.id]);
  });

  it("415 attachment_type for a non-image and for a Content-Type that differs from the bytes", async () => {
    const { task } = await setup();
    expect((await upload(task.id, Buffer.from("<svg/>"), { type: "image/svg+xml" })).json).toEqual({ error: "attachment_type" });
    const mismatch = await upload(task.id, pngBytes(), { type: "image/jpeg" });
    expect(mismatch.status).toBe(415);
    expect(mismatch.json.error).toBe("attachment_type");
    expect((await upload(task.id, jpegBytes(), { type: "image/jpeg" })).status).toBe(201);
  });

  it("413 attachment_too_large over 10 MB (raw limit), 10 MB exactly is accepted", async () => {
    const { task } = await setup();
    const over = await upload(task.id, pngOfSize(10 * 1024 * 1024 + 1));
    expect(over.status).toBe(413);
    expect(over.json.error).toBe("attachment_too_large");
    expect((await upload(task.id, pngOfSize(10 * 1024 * 1024))).status).toBe(201);
  });

  it("409 attachment_limit on the 9th (drafts count); 409 task_running in doing; 404 unknown task", async () => {
    const { task } = await setup();
    for (let i = 0; i < 7; i++) expect((await upload(task.id, pngBytes())).status).toBe(201);
    expect((await upload(task.id, pngBytes(), { query: "pending=1" })).status).toBe(201);
    const ninth = await upload(task.id, pngBytes());
    expect(ninth.status).toBe(409);
    expect(ninth.json).toEqual({ error: "attachment_limit", max: 8 });
    const running = await setup("doing");
    const r = await upload(running.task.id, pngBytes());
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("task_running");
    expect((await upload("task_nope", pngBytes())).status).toBe(404);
  });

  it("a draft (?pending=1) is not on the task and broadcasts nothing", async () => {
    const { task } = await setup("review", "feature/x");
    const r = await upload(task.id, pngBytes(), { query: "pending=1" });
    expect(r.status).toBe(201);
    expect(r.json.attachment.pending).toBe(true);
    expect((await getTask(task.id))!.attachments).toEqual([]);
    expect(ws.updated).toEqual([]);
  });
});

describe("GET / DELETE /api/attachments/:id", () => {
  it("serves the same bytes with mime, nosniff, inline disposition and immutable cache", async () => {
    const { task } = await setup();
    const buf = pngBytes(3, 3);
    const { json } = await upload(task.id, buf, { query: `name=${encodeURIComponent("ekran görüntüsü.png")}` });
    const res = await fetch(`${server.url}/api/attachments/${json.attachment.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("content-disposition")).toBe(
      `inline; filename="ekran g_r_nt_s_.png"; filename*=UTF-8''${encodeURIComponent("ekran görüntüsü.png")}`,
    );
    expect(Buffer.from(await res.arrayBuffer()).equals(buf)).toBe(true);
    expect((await fetch(`${server.url}/api/attachments/att_nope`)).status).toBe(404);
  });

  it("DELETE → 204, row + file gone, task_updated; 404 after; 409 task_running while doing", async () => {
    const { task } = await setup();
    const { json } = await upload(task.id, pngBytes());
    const path = getAttachment(json.attachment.id)!.path;
    ws.updated.length = 0;
    const r = await call("DELETE", `/api/attachments/${json.attachment.id}`);
    expect(r.status).toBe(204);
    expect(existsSync(path)).toBe(false);
    expect(getAttachment(json.attachment.id)).toBeNull();
    expect(ws.updated).toEqual([task.id]);
    expect((await call("DELETE", `/api/attachments/${json.attachment.id}`)).status).toBe(404);

    const other = await upload(task.id, pngBytes());
    await updateTask(task.id, { status: "doing" });
    const busy = await call("DELETE", `/api/attachments/${other.json.attachment.id}`);
    expect(busy.status).toBe(409);
    expect(busy.json.error).toBe("task_running");
    expect(getAttachment(other.json.attachment.id)).not.toBeNull();
  });
});

describe("comment with attachmentIds (§3/26)", () => {
  it("links the drafts before the comment runner starts; task payload gains them with commentId", async () => {
    const { task } = await setup("review", "feature/clf-1-x");
    const a = (await upload(task.id, pngBytes(), { query: "pending=1&name=kenar.png" })).json.attachment;
    const b = (await upload(task.id, pngBytes(), { query: "pending=1" })).json.attachment;
    const r = await call("POST", `/api/tasks/${task.id}/comments`, { body: "Kenarı kesik yap.", uiLang: "tr", attachmentIds: [a.id, b.id] });
    expect(r.status).toBe(201);
    const commentId = r.json.comment.id as string;
    expect(r.json.attachments.map((x: { id: string; commentId: string }) => [x.id, x.commentId])).toEqual([
      [a.id, commentId],
      [b.id, commentId],
    ]);
    await vi.waitFor(() => expect(runner.seen).toHaveLength(1));
    expect(runner.seen[0]).toEqual({ commentId, linked: [[a.id, commentId, 0], [b.id, commentId, 0]] });
    expect((await getTask(task.id))!.attachments.map((x) => [x.id, x.commentId])).toEqual([
      [a.id, commentId],
      [b.id, commentId],
    ]);
    expect(ws.updated).toContain(task.id);
  });

  it("a non-draft or foreign id → 400 attachment_not_pending, no comment is created, runner not started", async () => {
    const { task } = await setup("review", "feature/clf-2-x");
    const other = await setup("review", "feature/clf-3-x");
    const own = (await upload(task.id, pngBytes())).json.attachment;
    const foreign = (await upload(other.task.id, pngBytes(), { query: "pending=1" })).json.attachment;
    const draft = (await upload(task.id, pngBytes(), { query: "pending=1" })).json.attachment;
    for (const ids of [[draft.id, own.id], [draft.id, foreign.id], ["att_nope"]]) {
      const r = await call("POST", `/api/tasks/${task.id}/comments`, { body: "x", attachmentIds: ids });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("attachment_not_pending");
    }
    expect((await call("GET", `/api/tasks/${task.id}/comments`)).json.comments).toEqual([]);
    expect(getAttachment(draft.id)!.pending).toBe(1);
    expect(runner.seen).toEqual([]);
    const tooMany = await call("POST", `/api/tasks/${task.id}/comments`, { body: "x", attachmentIds: Array.from({ length: 9 }, (_, i) => `att_${i}`) });
    expect(tooMany.status).toBe(400);
  });

  it("without attachmentIds the comment flow is unchanged", async () => {
    const { task } = await setup("review", "feature/clf-4-x");
    const r = await call("POST", `/api/tasks/${task.id}/comments`, { body: "Sadece metin." });
    expect(r.status).toBe(201);
    expect(r.json.attachments).toEqual([]);
    await vi.waitFor(() => expect(runner.seen).toHaveLength(1));
    expect(ws.updated).toEqual([]);
  });
});

describe("cleanup with the task and the project (§3/33)", () => {
  it("DELETE task removes rows and the attachments directory; the image is 404 afterwards", async () => {
    const { task } = await setup();
    const a = (await upload(task.id, pngBytes())).json.attachment;
    await upload(task.id, pngBytes(), { query: "pending=1" });
    expect(existsSync(attachmentsDir(task.id))).toBe(true);
    expect((await call("DELETE", `/api/tasks/${task.id}`)).status).toBe(204);
    expect(existsSync(attachmentsDir(task.id))).toBe(false);
    expect(getAttachment(a.id)).toBeNull();
    expect((await fetch(`${server.url}/api/attachments/${a.id}`)).status).toBe(404);
  });

  it("DELETE project removes every task's attachments directory", async () => {
    const { project, task } = await setup();
    const t2 = await createTask({ projectId: project.id, title: "İkinci" });
    await upload(task.id, pngBytes());
    await upload(t2.id, pngBytes());
    expect((await call("DELETE", `/api/projects/${project.id}`)).status).toBe(204);
    expect(existsSync(attachmentsDir(task.id))).toBe(false);
    expect(existsSync(attachmentsDir(t2.id))).toBe(false);
  });
});
