/**
 * Resumable uploads, tus-style: create one (work, path, size), then append chunks at the offset
 * the server reports; a cut connection resumes from there. The bytes land in a hidden `.part`
 * next to their final place (the scanner ignores dotfiles) and are renamed when complete, so a
 * film of several GB never sits in memory, in /tmp, or half-written in the library.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync,
  writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Library } from "./library/index.ts";

const FREE_MARGIN = 512 * 1024 * 1024;

export interface Upload {
  id: string;
  workId: string;
  target: string;      // relative to the library root
  size: number;
  createdAt: string;
}

export class UploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class Uploads {
  constructor(private readonly dir: string, private readonly library: Library) {
    mkdirSync(dir, { recursive: true });
  }

  private metaPath(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new UploadError("unknown upload", 404);
    return join(this.dir, `${id}.json`);
  }

  private partPath(u: Upload): string {
    const abs = this.library.resolve(u.target);
    return join(dirname(abs), `.${basename(abs)}.${u.id}.part`);
  }

  get(id: string): Upload {
    const p = this.metaPath(id);
    if (!existsSync(p)) throw new UploadError("unknown upload", 404);
    return JSON.parse(readFileSync(p, "utf8")) as Upload;
  }

  offset(u: Upload): number {
    const part = this.partPath(u);
    return existsSync(part) ? statSync(part).size : existsSync(this.library.resolve(u.target)) ? u.size : 0;
  }

  create(workId: string, relPath: string, size: number): Upload {
    const work = this.library.get(workId);
    if (!work) throw new UploadError("unknown work", 404);
    if (!Number.isInteger(size) || size <= 0) throw new UploadError("size must be a positive integer");
    let target: string;
    try {
      target = this.library.target(work, relPath);
    } catch (err) {
      throw new UploadError((err as Error).message);
    }
    const abs = this.library.resolve(target);
    if (existsSync(abs)) throw new UploadError(`${basename(abs)} already exists; delete it first`, 409);
    mkdirSync(dirname(abs), { recursive: true });
    const fs = statfsSync(dirname(abs));
    if (fs.bavail * fs.bsize - size < FREE_MARGIN) throw new UploadError("not enough free space", 507);
    const u: Upload = { id: randomUUID(), workId, target, size, createdAt: new Date().toISOString() };
    writeFileSync(this.metaPath(u.id), JSON.stringify(u));
    return u;
  }

  /** Append a chunk at `offset`; returns the new offset and whether the file is complete. */
  async append(id: string, offset: number, body: Readable, length: number | null): Promise<{ offset: number; done: boolean }> {
    const u = this.get(id);
    const current = this.offset(u);
    if (offset !== current) throw new UploadError(`offset mismatch: the server has ${current}`, 409);
    if (length !== null && current + length > u.size) throw new UploadError("chunk goes past the declared size");
    const part = this.partPath(u);
    await pipeline(body, createWriteStream(part, { flags: "a" }));
    const now = statSync(part).size;
    if (now > u.size) {
      rmSync(part, { force: true });
      throw new UploadError("more bytes than declared; start again");
    }
    if (now === u.size) {
      renameSync(part, this.library.resolve(u.target));
      rmSync(this.metaPath(id), { force: true });
      return { offset: now, done: true };
    }
    return { offset: now, done: false };
  }

  cancel(id: string): void {
    const u = this.get(id);
    rmSync(this.partPath(u), { force: true });
    rmSync(this.metaPath(id), { force: true });
  }
}
