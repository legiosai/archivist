/**
 * The library on disk → works and their units. Nothing here writes: the folders are the truth
 * (SOUL.md), and this is how they read.
 *
 *   video/<work>.mp4 + <work>.yaml          a film: one unit
 *   video/<work>/S01E01.mkv … + work.yaml    a series or an anime: one unit per episode file
 *   pages/<work>/vol-01.cbz … + work.yaml    a manga or a comic: one unit per volume — an
 *                                            archive (CBZ, ZIP, PDF), a folder of images, or the
 *                                            images sitting in the work's own folder
 *   stills/<work>/… + work.yaml              screenshots: one unit
 *
 * Same layout as VT-Showrunner's inbox, so both read one copy of every file.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";

export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
export const VIDEO_EXT = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"]);
export const ARCHIVE_EXT = new Set([".cbz", ".zip", ".pdf"]);
export const SUBTITLE_EXT = new Set([".srt", ".vtt", ".ass", ".ssa"]);
export const TYPES = ["film", "series", "anime", "manga", "comic"] as const;

export type WorkType = (typeof TYPES)[number];
export type Kind = "video" | "pages" | "stills";

export interface Meta {
  title?: string;
  type?: string;
  year?: number;
  original_title?: string;
  ids?: Record<string, string | number>;
  reading?: "rtl" | "ltr" | "vertical";
  [key: string]: unknown;
}

export interface Unit {
  /** Stable inside its work: "film", "s01e02", "v03", "stills". */
  key: string;
  label: string;
  /** File or folder, relative to the library root. */
  path: string;
  format: "video" | "cbz" | "zip" | "pdf" | "images";
  season?: number;
  episode?: number;
  volume?: number;
  subtitles?: string[];
}

export interface Work {
  /** "<kind>/<slug>": unique in the library, stable while the folder keeps its name. */
  id: string;
  slug: string;
  kind: Kind;
  type: WorkType;
  title: string;
  year?: number;
  originalTitle?: string;
  ids: Record<string, string | number>;
  reading: "rtl" | "ltr" | "vertical" | null;
  /** The work's folder or file, relative to the library root. */
  path: string;
  units: Unit[];
}

/** "p2" before "p10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function slugTitle(slug: string): string {
  return slug.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function readMeta(...paths: string[]): Meta {
  for (const p of paths) {
    try {
      const data = parseYaml(readFileSync(p, "utf8"));
      return data && typeof data === "object" ? (data as Meta) : {};
    } catch {
      continue;
    }
  }
  return {};
}

function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && !d.name.endsWith(".part"))
      .sort((a, b) => naturalCompare(a.name, b.name));
  } catch {
    return [];
  }
}

const isType = (t: unknown): t is WorkType => TYPES.includes(t as WorkType);

/** Season and episode from a file name (S01E02, 1x02), or from the work's yaml. */
export function episodeOf(name: string, meta: Meta = {}): { season?: number; episode?: number } {
  const m = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/.exec(name) ?? /\b(\d{1,2})x(\d{2,3})\b/.exec(name);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  const s = Number(meta.season), e = Number(meta.episode);
  return { season: Number.isInteger(s) && s > 0 ? s : undefined, episode: Number.isInteger(e) && e > 0 ? e : undefined };
}

/** The volume number in "vol-03", "Tomo 3", "v03", "t3", else the first number, else none. */
export function volumeOf(name: string): number | undefined {
  const m = /(?:vol(?:ume|umen)?|tomo|v|t)\.?\s*_?(\d+)/i.exec(name) ?? /(\d+)/.exec(name);
  return m ? Number(m[1]) : undefined;
}

function work(root: string, kind: Kind, slug: string, rel: string, meta: Meta, fallback: WorkType, units: Unit[]): Work {
  const type = isType(meta.type) ? meta.type : fallback;
  const reading = meta.reading === "rtl" || meta.reading === "ltr" || meta.reading === "vertical"
    ? meta.reading : kind === "pages" ? (type === "manga" ? "rtl" : "ltr") : null;
  return {
    id: `${kind}/${slug}`, slug, kind, type, title: meta.title || slugTitle(slug),
    year: typeof meta.year === "number" ? meta.year : undefined,
    originalTitle: typeof meta.original_title === "string" ? meta.original_title : undefined,
    ids: meta.ids && typeof meta.ids === "object" ? meta.ids : {}, reading, path: rel, units,
  };
}

function subtitlesFor(dir: string, stem: string, relDir: string): string[] {
  return entries(dir)
    .filter((d) => d.isFile() && SUBTITLE_EXT.has(extname(d.name).toLowerCase()) && d.name.startsWith(stem))
    .map((d) => join(relDir, d.name));
}

function scanVideo(root: string): Work[] {
  const base = join(root, "video");
  const out: Work[] = [];
  const all = entries(base);
  const stems = new Set(all.map((d) => basename(d.name, extname(d.name))));
  for (const d of all) {
    const yext = extname(d.name).toLowerCase();
    if (d.isFile() && (yext === ".yaml" || yext === ".yml")) {
      // A film created in the app, waiting for its file (a sidecar with no video and no folder).
      const slug = basename(d.name, yext);
      const hasVideo = all.some((o) => o.name !== d.name && basename(o.name, extname(o.name)) === slug);
      if (!hasVideo && stems.has(slug)) {
        out.push(work(root, "video", slug, join("video", d.name), readMeta(join(base, d.name)), "film", []));
      }
      continue;
    }
    const ext = extname(d.name).toLowerCase();
    if (d.isFile() && VIDEO_EXT.has(ext)) {
      const slug = basename(d.name, extname(d.name));
      const meta = readMeta(join(base, `${slug}.yaml`), join(base, `${slug}.yml`));
      const rel = join("video", d.name);
      out.push(work(root, "video", slug, rel, meta, "film", [
        { key: "film", label: "Película", path: rel, format: "video", subtitles: subtitlesFor(base, slug, "video") },
      ]));
    } else if (d.isDirectory()) {
      const dir = join(base, d.name);
      const meta = readMeta(join(dir, "work.yaml"), join(dir, `${d.name}.yaml`), join(base, `${d.name}.yaml`));
      const files = entries(dir).filter((f) => f.isFile() && VIDEO_EXT.has(extname(f.name).toLowerCase()));
      if (!files.length && !Object.keys(meta).length) continue;
      const units: Unit[] = files.map((f, i) => {
        const { season, episode } = episodeOf(f.name, meta);
        const s = season ?? 1, e = episode ?? i + 1;
        const stem = basename(f.name, extname(f.name));
        return {
          key: `s${String(s).padStart(2, "0")}e${String(e).padStart(2, "0")}`, label: `T${s} · E${e}`,
          path: join("video", d.name, f.name), format: "video", season: s, episode: e,
          subtitles: subtitlesFor(dir, stem, join("video", d.name)),
        };
      });
      units.sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
      out.push(work(root, "video", d.name, join("video", d.name), meta, "series", units));
    }
  }
  return out;
}

function images(dir: string): Dirent[] {
  return entries(dir).filter((f) => f.isFile() && IMAGE_EXT.has(extname(f.name).toLowerCase()));
}

function scanPages(root: string): Work[] {
  const base = join(root, "pages");
  const out: Work[] = [];
  for (const d of entries(base)) {
    const ext = extname(d.name).toLowerCase();
    if (d.isFile() && ARCHIVE_EXT.has(ext)) {           // pages/<work>.cbz: a one-volume work
      const slug = basename(d.name, ext);
      const meta = readMeta(join(base, `${slug}.yaml`));
      const rel = join("pages", d.name);
      out.push(work(root, "pages", slug, rel, meta, "comic", [
        { key: "v01", label: "Tomo 1", path: rel, format: ext.slice(1) as Unit["format"], volume: 1 },
      ]));
      continue;
    }
    if (!d.isDirectory()) continue;
    const dir = join(base, d.name);
    const meta = readMeta(join(dir, "work.yaml"), join(dir, `${d.name}.yaml`), join(base, `${d.name}.yaml`));
    const units: Unit[] = [];
    const add = (name: string, path: string, format: Unit["format"], fallback: number) => {
      const volume = volumeOf(name) ?? fallback;
      units.push({ key: `v${String(volume).padStart(2, "0")}`, label: `Tomo ${volume}`, path, format, volume });
    };
    if (images(dir).length) add(String(meta.volume ?? 1), join("pages", d.name), "images", 1);
    for (const f of entries(dir)) {
      const fext = extname(f.name).toLowerCase();
      const rel = join("pages", d.name, f.name);
      if (f.isFile() && ARCHIVE_EXT.has(fext)) add(basename(f.name, fext), rel, fext.slice(1) as Unit["format"], units.length + 1);
      else if (f.isDirectory() && images(join(dir, f.name)).length) add(f.name, rel, "images", units.length + 1);
    }
    if (!units.length && !Object.keys(meta).length) continue;
    units.sort((a, b) => a.volume! - b.volume!);
    const fallback: WorkType = meta.reading === "rtl" ? "manga" : "comic";
    out.push(work(root, "pages", d.name, join("pages", d.name), meta, fallback, units));
  }
  return out;
}

function scanStills(root: string): Work[] {
  const base = join(root, "stills");
  return entries(base)
    .filter((d) => d.isDirectory() && images(join(base, d.name)).length)
    .map((d) => {
      const dir = join(base, d.name);
      const meta = readMeta(join(dir, "work.yaml"), join(base, `${d.name}.yaml`));
      const rel = join("stills", d.name);
      return work(root, "stills", d.name, rel, meta, "film", [{ key: "stills", label: "Capturas", path: rel, format: "images" }]);
    });
}

/** Every work in the library, video first, then pages and stills; each folder in natural order. */
export function scan(root: string): Work[] {
  statSync(root);   // a missing root is an error, not an empty library
  return [...scanVideo(root), ...scanPages(root), ...scanStills(root)];
}
