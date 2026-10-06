/**
 * The pages of a unit — a CBZ/ZIP, a PDF or a folder of images — as numbered images (1-based).
 * Archives are read entry by entry (zip.ts); PDF pages are rendered once with poppler's
 * pdftoppm and cached under the data folder.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { IMAGE_EXT, isPosterName, naturalCompare, type Unit } from "../library/scan.ts";
import { readZipEntry, readZipIndex, type ZipEntry } from "./zip.ts";

const run = promisify(execFile);

export const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif",
};

export interface Page {
  data: Buffer;
  type: string;
}

export interface PageSource {
  count: number;
  page(n: number): Promise<Page>;
}

const isImage = (name: string) => IMAGE_EXT.has(extname(name).toLowerCase());

function folderSource(dir: string): PageSource {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && isImage(d.name) && !isPosterName(d.name))
    .map((d) => d.name)
    .sort(naturalCompare);
  return {
    count: files.length,
    async page(n) {
      const name = files[n - 1];
      if (!name) throw new RangeError(`page ${n} out of range`);
      return { data: readFileSync(join(dir, name)), type: MIME[extname(name).toLowerCase()]! };
    },
  };
}

function zipSource(file: string): PageSource {
  const entries: ZipEntry[] = readZipIndex(file)
    .filter((e) => !e.name.endsWith("/") && isImage(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  return {
    count: entries.length,
    async page(n) {
      const e = entries[n - 1];
      if (!e) throw new RangeError(`page ${n} out of range`);
      return { data: readZipEntry(file, e), type: MIME[extname(e.name).toLowerCase()]! };
    },
  };
}

async function pdfSource(file: string, cacheDir: string): Promise<PageSource> {
  const { stdout } = await run("pdfinfo", [file]);
  const count = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
  const key = createHash("sha1").update(`${file}:${statSync(file).mtimeMs}`).digest("hex").slice(0, 16);
  const dir = join(cacheDir, "pdf", key);
  return {
    count,
    async page(n) {
      if (n < 1 || n > count) throw new RangeError(`page ${n} out of range`);
      const out = join(dir, `${n}.jpg`);
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, `.${n}-${process.pid}`);
        await run("pdftoppm", ["-f", String(n), "-l", String(n), "-r", "130", "-jpeg", "-jpegopt", "quality=85",
          "-singlefile", file, tmp]);
        renameSync(`${tmp}.jpg`, out);
      }
      return { data: readFileSync(out), type: "image/jpeg" };
    },
  };
}

const sources = new Map<string, { mtime: number; source: PageSource }>();

/** The unit's pages; sources are cached until the file changes. */
export async function openPages(root: string, unit: Unit, cacheDir: string): Promise<PageSource> {
  const path = join(root, unit.path);
  const mtime = statSync(path).mtimeMs;
  const hit = sources.get(path);
  if (hit && hit.mtime === mtime) return hit.source;
  let source: PageSource;
  if (unit.format === "images") source = folderSource(path);
  else if (unit.format === "cbz" || unit.format === "zip") source = zipSource(path);
  else if (unit.format === "pdf") source = await pdfSource(path, cacheDir);
  else throw new Error(`${unit.key} has no pages (format ${unit.format})`);
  if (sources.size > 64) sources.delete(sources.keys().next().value!);
  sources.set(path, { mtime, source });
  return source;
}
