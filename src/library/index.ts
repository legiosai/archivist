/**
 * The library in memory: the last scan, keyed by work id, rescanned on demand and every few
 * minutes. New works are created as a folder plus its yaml (the same files a person would write).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import type { Store } from "../db.ts";
import {
  ARCHIVE_EXT, IMAGE_EXT, SUBTITLE_EXT, TYPES, VIDEO_EXT, scan, type Unit, type Work, type WorkType,
} from "./scan.ts";

export interface NewWork {
  title: string;
  type: WorkType;
  year?: number;
  originalTitle?: string;
  ids?: Record<string, string | number>;
  slug?: string;
}

/** ASCII, lowercase, dashes: "La noche de los muertos vivientes" → "la-noche-de-los-muertos-vivientes". */
export function slugify(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "obra";
}

/** A single safe path segment: no separators, no dot-dot, no control characters. */
export function safeSegment(name: string): string {
  const s = name.normalize("NFC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").replace(/^\.+/, "").trim();
  if (!s || s === "." || s === "..") throw new Error(`invalid name: ${JSON.stringify(name)}`);
  return s.slice(0, 180);
}

export class Library {
  works = new Map<string, Work>();
  scannedAt = 0;

  readonly root: string;
  private readonly store?: Store;

  constructor(root: string, store?: Store) {
    this.root = root;
    this.store = store;
  }

  rescan(): { added: string[]; removed: string[] } {
    const next = new Map(scan(this.root).map((w) => [w.id, w]));
    const added = [...next.keys()].filter((id) => !this.works.has(id));
    const removed = [...this.works.keys()].filter((id) => !next.has(id));
    if (this.scannedAt && this.store) {
      for (const id of added) this.store.event("work_added", id);
      for (const id of removed) this.store.event("work_removed", id);
    }
    this.works = next;
    this.scannedAt = Date.now();
    return { added, removed };
  }

  list(): Work[] {
    return [...this.works.values()];
  }

  get(id: string): Work | undefined {
    return this.works.get(id);
  }

  unit(work: Work, key: string): Unit | undefined {
    return work.units.find((u) => u.key === key);
  }

  /** An absolute path under the library root, or an error: every request path goes through this. */
  resolve(rel: string): string {
    const abs = resolve(this.root, rel);
    const back = relative(resolve(this.root), abs);
    if (back === "" || back.startsWith("..") || isAbsolute(back)) throw new Error(`outside the library: ${rel}`);
    return abs;
  }

  create(w: NewWork): Work {
    if (!TYPES.includes(w.type)) throw new Error(`type must be one of ${TYPES.join(", ")}`);
    if (!w.title?.trim()) throw new Error("a work needs a title");
    const slug = slugify(w.slug || w.title);
    const kind = w.type === "manga" || w.type === "comic" ? "pages" : "video";
    const meta: Record<string, unknown> = { title: w.title.trim(), type: w.type };
    if (w.year) meta.year = w.year;
    if (w.originalTitle) meta.original_title = w.originalTitle;
    if (w.ids && Object.keys(w.ids).length) meta.ids = w.ids;
    if (kind === "pages") meta.reading = w.type === "manga" ? "rtl" : "ltr";
    const id = `${kind}/${slug}`;
    if (this.works.has(id)) return this.works.get(id)!;
    const yaml = stringify(meta);
    if (w.type === "film") {
      mkdirSync(join(this.root, "video"), { recursive: true });
      writeFileSync(join(this.root, "video", `${slug}.yaml`), yaml);
    } else {
      const dir = join(this.root, kind, slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "work.yaml"), yaml);
    }
    this.rescan();
    return this.works.get(id)!;
  }

  /**
   * Where an uploaded file goes, relative to the root. `relPath` may carry one folder for pages
   * ("Vol 1/001.jpg": a volume as a folder of images). Refuses what the work cannot hold.
   */
  target(work: Work, relPath: string): string {
    const parts = relPath.split(/[\\/]+/).filter(Boolean).map(safeSegment);
    const name = parts.at(-1)!;
    const ext = extname(name).toLowerCase();
    if (work.kind === "pages") {
      if (!ARCHIVE_EXT.has(ext) && !IMAGE_EXT.has(ext)) throw new Error(`${name}: not a page archive or an image`);
      const sub = IMAGE_EXT.has(ext) && parts.length > 1 ? [parts.at(-2)!] : [];
      return join("pages", work.slug, ...sub, name);
    }
    if (work.kind === "stills") {
      if (!IMAGE_EXT.has(ext)) throw new Error(`${name}: not an image`);
      return join("stills", work.slug, name);
    }
    if (!VIDEO_EXT.has(ext) && !SUBTITLE_EXT.has(ext)) throw new Error(`${name}: not a video or a subtitle file`);
    if (work.type === "film") {
      if (VIDEO_EXT.has(ext)) return join("video", `${work.slug}${ext}`);
      const lang = /\.([a-z]{2,3})\.[a-z]+$/i.exec(name)?.[1];
      return join("video", `${work.slug}${lang ? `.${lang}` : ""}${ext}`);
    }
    return join("video", work.slug, name);
  }
}
