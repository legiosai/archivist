/**
 * The HTTP server: the API under /api/v1 (the UI uses the same one) and the built UI. Plain
 * node:http, no framework. Auth: `Authorization: Bearer <token>` for tools, or the same token in
 * an HttpOnly cookie after POST /api/v1/login for the browser.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { extname, join, normalize } from "node:path";
import type { Config } from "./config.ts";
import { Store, type Progress } from "./db.ts";
import { Library } from "./library/index.ts";
import type { Unit, Work } from "./library/scan.ts";
import { openPages } from "./media/pages.ts";
import { frame, playable, prepare, probe, subtitlesVtt } from "./media/video.ts";
import { UploadError, Uploads } from "./uploads.ts";

const RESCAN_MS = 5 * 60_000;
const COOKIE = "archivist_token";
const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Params = Record<string, string>;
type Handler = (req: IncomingMessage, res: ServerResponse, p: Params, url: URL) => Promise<void> | void;

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(data);
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

/** A file with HTTP Range support (video seeking). */
function sendFile(req: IncomingMessage, res: ServerResponse, path: string, type: string, cache = "private, max-age=3600"): void {
  const size = statSync(path).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    if (!range[1]) end = size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes", "cache-control": cache });
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": cache });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(path).pipe(res);
}

function sameToken(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(req: IncomingMessage): string | undefined {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? "");
  return m ? decodeURIComponent(m[1]!) : undefined;
}

export interface App {
  server: Server;
  library: Library;
  store: Store;
  close(): Promise<void>;
}

export function createApp(cfg: Config): App {
  const store = new Store(join(cfg.data, "archivist.db"));
  const library = new Library(cfg.library, store);
  library.rescan();
  const uploads = new Uploads(join(cfg.data, "uploads"), library);
  const cache = join(cfg.data, "cache");
  const routes: { method: string; parts: string[]; handler: Handler; open?: boolean }[] = [];
  const route = (method: string, pattern: string, handler: Handler, open = false) =>
    routes.push({ method, parts: pattern.split("/").filter(Boolean), handler, open });

  const authed = (req: IncomingMessage) => !cfg.token
    || sameToken(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1], cfg.token)
    || sameToken(cookieToken(req), cfg.token);

  // --- views of a work for the API ---------------------------------------------------------
  function workView(w: Work, withUnits = false) {
    const progress = store.forWork(w.id);
    const byUnit = new Map(progress.map((p) => [p.unitKey, p]));
    const last = progress.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    const base = {
      id: w.id, slug: w.slug, kind: w.kind, type: w.type, title: w.title, year: w.year ?? null,
      originalTitle: w.originalTitle ?? null, ids: w.ids, reading: w.reading, units: w.units.length,
      finished: w.units.filter((u) => byUnit.get(u.key)?.finished).length, last,
      cover: w.units.length ? `/api/v1/works/${w.id}/cover` : null,
    };
    if (!withUnits) return base;
    return { ...base, unitList: w.units.map((u) => unitView(w, u, byUnit.get(u.key) ?? null)) };
  }

  function unitView(w: Work, u: Unit, p: Progress | null) {
    return {
      key: u.key, label: u.label, format: u.format, season: u.season ?? null, episode: u.episode ?? null,
      volume: u.volume ?? null, subtitles: (u.subtitles ?? []).length, progress: p,
      href: `/api/v1/units/${w.id}/${u.key}`,
    };
  }

  function find(p: Params): { work: Work; unit: Unit } {
    const work = library.get(`${p.kind}/${p.slug}`);
    if (!work) throw new HttpError(404, "unknown work");
    const unit = library.unit(work, p.unit!);
    if (!unit) throw new HttpError(404, "unknown unit");
    return { work, unit };
  }

  // --- routes ------------------------------------------------------------------------------
  route("GET", "/api/v1/health", (_q, res) => json(res, 200, { ok: true, works: library.works.size }), true);

  route("POST", "/api/v1/login", async (req, res) => {
    const body = await readJson(req);
    if (cfg.token && !sameToken(String(body.token ?? ""), cfg.token)) throw new HttpError(401, "wrong token");
    json(res, 200, { ok: true }, cfg.token ? {
      "set-cookie": `${COOKIE}=${encodeURIComponent(cfg.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
    } : {});
  }, true);

  route("GET", "/api/v1/works", (_q, res) => {
    const works = library.list().map((w) => workView(w));
    works.sort((a, b) => a.title.localeCompare(b.title, "es"));
    json(res, 200, { works });
  });

  route("POST", "/api/v1/works", async (req, res) => {
    const b = await readJson(req);
    try {
      const w = library.create({
        title: String(b.title ?? ""), type: b.type as Work["type"], year: Number(b.year) || undefined,
        originalTitle: b.originalTitle ? String(b.originalTitle) : undefined,
        ids: b.ids && typeof b.ids === "object" ? b.ids as Record<string, string> : undefined,
        slug: b.slug ? String(b.slug) : undefined,
      });
      json(res, 201, workView(w, true));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  route("GET", "/api/v1/works/:kind/:slug", (_q, res, p) => {
    const w = library.get(`${p.kind}/${p.slug}`);
    if (!w) throw new HttpError(404, "unknown work");
    json(res, 200, workView(w, true));
  });

  route("GET", "/api/v1/works/:kind/:slug/cover", async (req, res, p) => {
    const w = library.get(`${p.kind}/${p.slug}`);
    const unit = w?.units[0];
    if (!w || !unit) throw new HttpError(404, "no cover");
    if (unit.format === "video") {
      const file = library.resolve(unit.path);
      const pr = await probe(file);
      const img = await frame(file, Math.min(600, pr.duration * 0.1), cache);
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" });
      res.end(img);
      return;
    }
    const pages = await openPages(cfg.library, unit, cache);
    const page = await pages.page(1);
    res.writeHead(200, { "content-type": page.type, "cache-control": "private, max-age=86400" });
    res.end(page.data);
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/pages", async (_q, res, p) => {
    const { unit } = find(p);
    const pages = await openPages(cfg.library, unit, cache);
    json(res, 200, { count: pages.count });
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/pages/:n", async (_q, res, p) => {
    const { unit } = find(p);
    const pages = await openPages(cfg.library, unit, cache);
    const n = Number(p.n);
    if (!Number.isInteger(n) || n < 1 || n > pages.count) throw new HttpError(404, "no such page");
    const page = await pages.page(n);
    res.writeHead(200, { "content-type": page.type, "content-length": page.data.length, "cache-control": "private, max-age=86400" });
    res.end(page.data);
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/video", async (req, res, p) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    const file = library.resolve(unit.path);
    const got = await playable(file, cache);
    if ("job" in got) {
      json(res, 409, { preparing: true, ...got.job });
      return;
    }
    sendFile(req, res, got.path, "video/" + (extname(got.path).toLowerCase() === ".webm" ? "webm" : "mp4"));
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/info", async (_q, res, p) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    const file = library.resolve(unit.path);
    const pr = await probe(file);
    const got = await playable(file, cache);
    json(res, 200, { duration: pr.duration, video: pr.video, audio: pr.audio, ready: !("job" in got),
      job: "job" in got ? got.job : null, subtitles: (unit.subtitles ?? []).map((s, i) => ({
        index: i, label: s.split("/").at(-1), href: `/api/v1/units/${p.kind}/${p.slug}/${unit.key}/subtitles/${i}` })) });
  });

  route("POST", "/api/v1/units/:kind/:slug/:unit/prepare", async (_q, res, p) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    json(res, 202, await prepare(library.resolve(unit.path), cache));
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/frame", async (_q, res, p, url) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    const t = Number(url.searchParams.get("t") ?? 0);
    if (!Number.isFinite(t) || t < 0) throw new HttpError(400, "t must be seconds");
    const img = await frame(library.resolve(unit.path), t, cache);
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" });
    res.end(img);
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/subtitles/:i", async (_q, res, p) => {
    const { unit } = find(p);
    const sub = (unit.subtitles ?? [])[Number(p.i)];
    if (!sub) throw new HttpError(404, "no such subtitle");
    const vtt = await subtitlesVtt(library.resolve(sub));
    res.writeHead(200, { "content-type": "text/vtt; charset=utf-8", "cache-control": "private, max-age=3600" });
    res.end(vtt);
  });

  route("GET", "/api/v1/progress", (_q, res) => {
    const latest = store.latest().filter((p) => library.get(p.workId)).map((p) => ({
      ...p, work: workView(library.get(p.workId)!),
    }));
    json(res, 200, { latest, all: store.all() });
  });

  route("PUT", "/api/v1/progress/:kind/:slug/:unit", async (req, res, p) => {
    const { work, unit } = find(p);
    const b = await readJson(req);
    const position = Number(b.position), total = Number(b.total);
    if (!Number.isFinite(position) || !Number.isFinite(total) || position < 0 || total < 0) {
      throw new HttpError(400, "position and total must be numbers");
    }
    const kind = unit.format === "video" ? "video" : "pages";
    json(res, 200, store.save(work.id, unit.key, position, total, kind));
  });

  route("GET", "/api/v1/events", (_q, res, _p, url) => {
    json(res, 200, { events: store.events(Number(url.searchParams.get("since") ?? 0)) });
  });

  route("POST", "/api/v1/rescan", (_q, res) => json(res, 200, library.rescan()));

  route("POST", "/api/v1/uploads", async (req, res) => {
    const b = await readJson(req);
    const u = uploads.create(String(b.workId ?? ""), String(b.path ?? ""), Number(b.size));
    json(res, 201, { id: u.id, offset: 0, target: u.target });
  });

  route("HEAD", "/api/v1/uploads/:id", (_q, res, p) => {
    const u = uploads.get(p.id!);
    res.writeHead(200, { "upload-offset": String(uploads.offset(u)), "upload-length": String(u.size), "cache-control": "no-store" });
    res.end();
  });

  route("PATCH", "/api/v1/uploads/:id", async (req, res, p) => {
    const offset = Number(req.headers["upload-offset"]);
    if (!Number.isInteger(offset)) throw new HttpError(400, "Upload-Offset header required");
    const len = req.headers["content-length"] ? Number(req.headers["content-length"]) : null;
    const out = await uploads.append(p.id!, offset, req, len);
    if (out.done) library.rescan();
    res.writeHead(204, { "upload-offset": String(out.offset), "upload-done": String(out.done) });
    res.end();
  });

  route("DELETE", "/api/v1/uploads/:id", (_q, res, p) => {
    uploads.cancel(p.id!);
    res.writeHead(204);
    res.end();
  });

  // --- dispatch ----------------------------------------------------------------------------
  function match(method: string, path: string): { handler: Handler; params: Params; open: boolean } | null {
    const parts = path.split("/").filter(Boolean).map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    for (const r of routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Params = {};
      if (r.parts.every((seg, i) => seg.startsWith(":") ? (params[seg.slice(1)] = parts[i]!, true) : seg === parts[i])) {
        return { handler: r.handler, params, open: !!r.open };
      }
    }
    return null;
  }

  function serveWeb(req: IncomingMessage, res: ServerResponse, path: string): void {
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
    let file = join(cfg.web, rel);
    if (!file.startsWith(cfg.web) || !existsSync(file) || statSync(file).isDirectory()) file = join(cfg.web, "index.html");
    if (!existsSync(file)) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("archivist API is running. The UI is not built: npm run build.");
      return;
    }
    const type = STATIC_TYPES[extname(file)] ?? "application/octet-stream";
    const immutable = file.includes(`${join(cfg.web, "assets")}`);
    res.writeHead(200, { "content-type": type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    res.end(readFileSync(file));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://archivist");
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
        serveWeb(req, res, url.pathname);
        return;
      }
      const hit = match(req.method ?? "GET", url.pathname);
      if (!hit) throw new HttpError(404, "not found");
      if (!hit.open && !authed(req)) throw new HttpError(401, "token required");
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin && cfg.token) {
        const host = req.headers.host ?? "";
        if (!req.headers.origin.endsWith(`//${host}`)) throw new HttpError(403, "cross-site request refused");
      }
      await hit.handler(req, res, hit.params, url);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof UploadError ? err.status
        : err instanceof RangeError ? 404 : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) json(res, status, { error: status === 500 ? "internal error" : (err as Error).message });
      else res.end();
    }
  });

  const timer = setInterval(() => {
    try { library.rescan(); } catch (err) { console.error("rescan failed", err); }
  }, RESCAN_MS);
  timer.unref();

  return {
    server, library, store,
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => { store.close(); resolve(); }); }),
  };
}
