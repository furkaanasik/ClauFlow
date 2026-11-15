import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorMessage } from "../utils/error.js";

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

class FsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function fsErrorFrom(err: unknown, target: string): FsError {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return new FsError(404, "not_found", `Path does not exist: ${target}`);
  if (code === "EACCES" || code === "EPERM") return new FsError(403, "permission_denied", `Permission denied: ${target}`);
  if (code === "ENOTDIR") return new FsError(400, "not_a_directory", `Not a directory: ${target}`);
  if (code === "EEXIST") return new FsError(409, "already_exists", `Already exists: ${target}`);
  if (code === "ELOOP") return new FsError(400, "symlink_loop", `Too many symbolic links: ${target}`);
  return new FsError(500, "fs_error", errorMessage(err));
}

function sendFsError(res: Response, err: unknown, target: string): void {
  const e = err instanceof FsError ? err : fsErrorFrom(err, target);
  res.status(e.status).json({ error: e.code, message: e.message, path: target });
}

function normalizeAbsolute(raw: string): string {
  if (raw.includes("\0")) throw new FsError(400, "invalid_path", "Path contains a NUL byte");
  if (!path.isAbsolute(raw)) throw new FsError(400, "invalid_path", `Path must be absolute: ${raw}`);
  return path.resolve(raw);
}

async function assertDirectory(dir: string): Promise<void> {
  const stat = await fs.stat(dir).catch((err: unknown) => {
    throw fsErrorFrom(err, dir);
  });
  if (!stat.isDirectory()) throw new FsError(400, "not_a_directory", `Not a directory: ${dir}`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectoryEntry(dir: string, dirent: Dirent): Promise<boolean> {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return (await fs.stat(path.join(dir, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

async function toEntry(dir: string, name: string): Promise<DirEntry> {
  const full = path.join(dir, name);
  return { name, path: full, isGitRepo: await exists(path.join(full, ".git")) };
}

function isTruthyFlag(v: unknown): boolean {
  return v === "1" || v === "true";
}

const router = Router();

router.get("/browse", async (req: Request, res: Response) => {
  const rawPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
  let dir = rawPath;
  try {
    if (req.query.path !== undefined && typeof req.query.path !== "string") {
      throw new FsError(400, "invalid_path", "path must be a single string");
    }
    dir = rawPath ? normalizeAbsolute(rawPath) : os.homedir();
    await assertDirectory(dir);

    const showHidden = isTruthyFlag(req.query.showHidden);
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch((err: unknown) => {
      throw fsErrorFrom(err, dir);
    });

    const candidates = dirents.filter((d) => showHidden || !d.name.startsWith("."));
    const flags = await Promise.all(candidates.map((d) => isDirectoryEntry(dir, d)));
    const names = candidates.filter((_, i) => flags[i]).map((d) => d.name);
    const entries = await Promise.all(names.map((name) => toEntry(dir, name)));
    entries.sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
        a.name.localeCompare(b.name),
    );

    res.json({
      path: dir,
      parent: dir === path.parse(dir).root ? null : path.dirname(dir),
      home: os.homedir(),
      entries,
    });
  } catch (err) {
    sendFsError(res, err, dir);
  }
});

const mkdirSchema = z.object({
  parent: z.string().min(1),
  name: z.string(),
});

function validateFolderName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new FsError(400, "invalid_name", "Folder name is required");
  if (name === "." || name === "..") throw new FsError(400, "invalid_name", "Folder name cannot be . or ..");
  if (/[/\\\0]/.test(name)) throw new FsError(400, "invalid_name", "Folder name cannot contain /, \\ or NUL");
  if (Buffer.byteLength(name, "utf8") > 255) throw new FsError(400, "invalid_name", "Folder name is too long");
  return name;
}

router.post("/mkdir", async (req: Request, res: Response) => {
  const parsed = mkdirSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  let target = parsed.data.parent;
  try {
    const parent = normalizeAbsolute(parsed.data.parent);
    target = parent;
    const name = validateFolderName(parsed.data.name);
    await assertDirectory(parent);
    target = path.join(parent, name);
    await fs.mkdir(target).catch((err: unknown) => {
      throw fsErrorFrom(err, target);
    });
    res.status(201).json(await toEntry(parent, name));
  } catch (err) {
    sendFsError(res, err, target);
  }
});

export default router;
