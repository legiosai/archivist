/**
 * The HTTP server: the API under /api/v1 (the UI uses the same one), the MCP server for agents at
 * /mcp, OPDS for phone readers, and the built UI. Plain node:http, no framework. Auth:
 * `Authorization: Bearer <token>` for tools and agents, Basic for OPDS, and for the browser a
 * revocable session cookie from POST /api/v1/login (the cookie never holds the token). What
 * changes behind a public proxy is in security.ts.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { isTrusted, trustedNetworks, type Config } from "./config.ts";
import { OWNER, Store, type Progress } from "./db.ts";
import { Library } from "./library/index.ts";
import type { Unit, Work } from "./library/scan.ts";
import { openPages } from "./media/pages.ts";
import { rootFeed, workFeed, worksFeed } from "./opds.ts";
import { frame, playable, prepare, probe, subtitlesVtt } from "./media/video.ts";
import { UploadError, Uploads } from "./uploads.ts";
import { FailureLimiter, clientOf, hardenHeaders, localHost } from "./security.ts";
import { serveMcp, type Catalog } from "./mcp.ts";
import { llmsTxt, openapi } from "./openapi.ts";
import { search } from "./search.ts";
import { scaleDown, thumbWidth, thumbnail } from "./media/image.ts";

const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  } catch {
    return "0.0.0";
  }
})();

const RESCAN_MS = 5 * 60_000;
const SESSION_COOKIE = "archivist_session";
const PROFILE_COOKIE = "archivist_profile";
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

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const raw = await readBody(req, limit);
  try {
    const v = JSON.parse(raw || "{}");
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

function cookie(req: IncomingMessage, name: string): string | undefined {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? "");
  return m ? decodeURIComponent(m[1]!) : undefined;
}

const sessionId = (req: IncomingMessage) => cookie(req, SESSION_COOKIE);

export interface App {
  server: Server;
  library: Library;
  store: Store;
  close(): Promise<void>;
}

export function createApp(cfg: Config): App {
  const store = new Store(join(cfg.data, "archivist.db"), process.env.ARCHIVIST_OWNER_NAME || "Yo");
  const library = new Library(cfg.library, store);
  library.rescan();
  const uploads = new Uploads(join(cfg.data, "uploads"), library);
  const cache = join(cfg.data, "cache");
  const routes: { method: string; parts: string[]; handler: Handler; open?: boolean }[] = [];
  const route = (method: string, pattern: string, handler: Handler, open = false) =>
    routes.push({ method, parts: pattern.split("/").filter(Boolean), handler, open });

  // Only the socket's address counts, and a request that came through the reverse proxy is never
  // trusted (security.ts): from the tunnel, 127.0.0.1 means "someone on the internet".
  const trusted = cfg.trusted ?? trustedNetworks("");
  const proxies = cfg.proxies ?? trustedNetworks("loopback");
  const limiter = new FailureLimiter();
  const fromTrusted = (req: IncomingMessage) => !clientOf(req, proxies).proxied && isTrusted(trusted, req.socket.remoteAddress)
    && localHost(req.headers.host, cfg.hosts);
  // Basic auth too (any user name, the token as password): it is what OPDS readers speak.
  const basicPassword = (req: IncomingMessage) => {
    const b = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!b) return undefined;
    const raw = Buffer.from(b, "base64").toString("utf8");
    return raw.slice(raw.indexOf(":") + 1);
  };
  const authed = (req: IncomingMessage) => !cfg.token || fromTrusted(req)
    || sameToken(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1], cfg.token)
    || sameToken(basicPassword(req), cfg.token)
    || store.checkSession(sessionId(req));
  const presentedCredentials = (req: IncomingMessage) => !!req.headers.authorization || !!sessionId(req);
  const failed = (req: IncomingMessage, path: string) => {
    const c = clientOf(req, proxies);
    const n = limiter.fail(c.ip);
    // One line per failure, for CrowdSec (journald): never the credential itself.
    console.warn(`archivist: auth failure from ${c.ip} on ${path} (${n})`);
  };

  /**
   * Whose progress a request reads and writes: the X-Archivist-Profile header or ?profile= (tools),
   * the profile cookie (the browser), or the Basic auth user name (OPDS readers); else the owner.
   */
  function who(req: IncomingMessage, url?: URL): string {
    const basicUser = (() => {
      const b = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      return b ? Buffer.from(b, "base64").toString("utf8").split(":")[0] : undefined;
    })();
    for (const c of [req.headers["x-archivist-profile"], url?.searchParams.get("profile"), cookie(req, PROFILE_COOKIE), basicUser]) {
      const id = typeof c === "string" ? c.trim().toLowerCase() : "";
      if (id && store.hasProfile(id)) return id;
    }
    return OWNER;
  }

  // --- views of a work for the API ---------------------------------------------------------
  function workView(w: Work, withUnits = false, profile = OWNER) {
    const progress = store.forWork(w.id, profile);
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

  function status(w: ReturnType<typeof workView>): "reading" | "finished" | "unstarted" {
    if (w.units && w.finished === w.units) return "finished";
    return w.last || w.finished ? "reading" : "unstarted";
  }

  // What the MCP tools see: the same views as the API.
  const catalog: Catalog = {
    version: VERSION,
    search: (q, type, limit, profile) => search(library.list().filter((w) => !type || w.type === type), q, limit)
      .map((r) => ({ ...workView(r.work, false, profile), score: r.score })),
    works: (type, state, profile) => library.list().filter((w) => !type || w.type === type)
      .map((w) => workView(w, false, profile)).filter((w) => !state || status(w) === state)
      .sort((a, b) => a.title.localeCompare(b.title, "es")),
    work: (id, profile) => {
      const w = library.get(id);
      return w ? workView(w, true, profile) : null;
    },
    progress: (profile) => ({ profile, latest: store.latest(profile).filter((p) => library.get(p.workId)).map((p) => ({
      ...p, work: library.get(p.workId)!.title })) }),
    saveProgress: (id, key, position, total, profile) => {
      const { work, unit } = findById(id, key);
      return store.save(work.id, unit.key, position, total, unit.format === "video" ? "video" : "pages", new Date(), profile);
    },
    pages: async (id, key) => {
      const { unit } = findById(id, key);
      if (unit.format === "video") throw new HttpError(400, "this unit is a video: use get_frame");
      return (await openPages(cfg.library, unit, cache)).count;
    },
    page: async (id, key, n, maxWidth) => {
      const { unit } = findById(id, key);
      const page = await (await openPages(cfg.library, unit, cache)).page(n);
      return scaleDown(page.data, page.type, maxWidth);
    },
    duration: async (id, key) => {
      const { unit } = findById(id, key);
      if (unit.format !== "video") throw new HttpError(400, "this unit has pages: use get_page");
      return (await probe(library.resolve(unit.path))).duration;
    },
    frame: async (id, key, seconds, maxWidth) => {
      const { unit } = findById(id, key);
      const img = await frame(library.resolve(unit.path), seconds, cache);
      return maxWidth && maxWidth < 1920 ? (await scaleDown(img, "image/jpeg", maxWidth)).data : img;
    },
    events: (since) => ({ events: store.events(since, 200) }),
    profiles: () => ({ profiles: store.profiles() }),
    profileExists: (id) => store.hasProfile(id),
  };

  function findById(id: string, key: string): { work: Work; unit: Unit } {
    const [kind, ...rest] = id.split("/");
    return find({ kind: kind ?? "", slug: rest.join("/"), unit: key });
  }

  const baseUrl = (req: IncomingMessage) => `${clientOf(req, proxies).https ? "https" : "http"}://${req.headers.host ?? "localhost"}`;

  // --- routes ------------------------------------------------------------------------------
  route("GET", "/api/v1/openapi.json", (req, res) => json(res, 200, openapi(VERSION, baseUrl(req))), true);
  route("GET", "/llms.txt", (req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });
    res.end(llmsTxt(baseUrl(req)));
  }, true);

  route("POST", "/mcp", async (req, res, _p, url) => {
    const raw = await readBody(req, 1024 * 1024);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    await serveMcp(res, catalog, body, who(req, url));
  });
  route("GET", "/mcp", (_q, res) => {
    res.writeHead(405, { allow: "POST" });
    res.end();
  });

  route("GET", "/api/v1/search", (req, res, _p, url) => {
    const q = url.searchParams.get("q") ?? "";
    const type = url.searchParams.get("type") || undefined;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    json(res, 200, { results: catalog.search(q, type, limit, who(req, url)) });
  });
  route("GET", "/api/v1/health", (req, res) => json(res, 200, { ok: true, works: library.works.size,
    open: !cfg.token || fromTrusted(req) }), true);

  route("POST", "/api/v1/login", async (req, res) => {
    const body = await readJson(req);
    const c = clientOf(req, proxies);
    if (cfg.token && !sameToken(String(body.token ?? ""), cfg.token)) {
      failed(req, "/api/v1/login");
      throw new HttpError(401, "wrong token");
    }
    limiter.clear(c.ip);
    if (!cfg.token) { json(res, 200, { ok: true }); return; }
    const id = store.createSession(c.ip, String(req.headers["user-agent"] ?? ""));
    json(res, 200, { ok: true }, {
      "set-cookie": `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Store.SESSION_DAYS * 86400}${c.https ? "; Secure" : ""}`,
    });
  }, true);

  route("POST", "/api/v1/logout", (req, res) => {
    const id = sessionId(req);
    if (id) store.endSession(id);
    json(res, 200, { ok: true }, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }, true);

  route("GET", "/api/v1/sessions", (_q, res) => json(res, 200, { sessions: store.sessions() }));
  route("DELETE", "/api/v1/sessions", (_q, res) => json(res, 200, { ended: store.endAllSessions() }));

  route("GET", "/api/v1/works", (req, res, _p, url) => {
    const profile = who(req, url);
    const works = library.list().map((w) => workView(w, false, profile));
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
      json(res, 201, workView(w, true, who(req)));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  route("GET", "/api/v1/works/:kind/:slug", (req, res, p, url) => {
    const w = library.get(`${p.kind}/${p.slug}`);
    if (!w) throw new HttpError(404, "unknown work");
    json(res, 200, workView(w, true, who(req, url)));
  });

  /** An image as is, or its cached `?w=` copy for grids. */
  async function sendImage(res: ServerResponse, url: URL, key: string, source: () => Promise<{ type: string; data: Buffer }>) {
    const w = thumbWidth(url.searchParams.get("w"));
    const img = w ? await thumbnail(cache, key, w, source) : await source();
    res.writeHead(200, { "content-type": img.type, "content-length": img.data.length, "cache-control": "private, max-age=86400" });
    res.end(img.data);
  }
  const version = (u: Unit) => `${u.path}:${statSync(library.resolve(u.path)).mtimeMs}`;

  route("GET", "/api/v1/works/:kind/:slug/cover", async (_q, res, p, url) => {
    const w = library.get(`${p.kind}/${p.slug}`);
    const unit = w?.units[0];
    if (!w || !unit) throw new HttpError(404, "no cover");
    await sendImage(res, url, `cover:${version(unit)}`, async () => {
      if (unit.format === "video") {
        // A few moments of the first act; the one with the most detail wins (a dark or flat frame
        // compresses to almost nothing, so the JPEG's size is a fair measure).
        const file = library.resolve(unit.path);
        const pr = await probe(file);
        const shots = await Promise.all([0.08, 0.15, 0.22, 0.3].map((share) => frame(file, pr.duration * share, cache)));
        return { type: "image/jpeg", data: shots.reduce((a, b) => (b.length > a.length ? b : a)) };
      }
      return (await openPages(cfg.library, unit, cache)).page(1);
    });
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/pages", async (_q, res, p) => {
    const { unit } = find(p);
    const pages = await openPages(cfg.library, unit, cache);
    json(res, 200, { count: pages.count });
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/pages/:n", async (_q, res, p, url) => {
    const { unit } = find(p);
    const pages = await openPages(cfg.library, unit, cache);
    const n = Number(p.n);
    if (!Number.isInteger(n) || n < 1 || n > pages.count) throw new HttpError(404, "no such page");
    await sendImage(res, url, `page:${version(unit)}:${n}`, () => pages.page(n));
  });

  // Through the public proxy, video is off unless ARCHIVIST_PROXIED_VIDEO=on: a CDN's free plan is
  // not a video host, and at home the LAN or Tailscale serve it better anyway.
  const videoAllowed = (req: IncomingMessage) => cfg.proxiedVideo || !clientOf(req, proxies).proxied;

  route("GET", "/api/v1/units/:kind/:slug/:unit/video", async (req, res, p) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    if (!videoAllowed(req)) throw new HttpError(403, "video is only served on the home network or Tailscale");
    const file = library.resolve(unit.path);
    const got = await playable(file, cache);
    if ("job" in got) {
      json(res, 409, { preparing: true, ...got.job });
      return;
    }
    sendFile(req, res, got.path, "video/" + (extname(got.path).toLowerCase() === ".webm" ? "webm" : "mp4"));
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/info", async (req, res, p) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    const file = library.resolve(unit.path);
    const pr = await probe(file);
    const got = await playable(file, cache);
    json(res, 200, { duration: pr.duration, video: pr.video, audio: pr.audio, ready: !("job" in got),
      allowed: videoAllowed(req),
      job: "job" in got ? got.job : null, subtitles: (unit.subtitles ?? []).map((s, i) => ({
        index: i, label: s.split("/").at(-1), href: `/api/v1/units/${p.kind}/${p.slug}/${unit.key}/subtitles/${i}` })) });
  });

  route("POST", "/api/v1/units/:kind/:slug/:unit/prepare", async (req, res, p) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    if (!videoAllowed(req)) throw new HttpError(403, "video is only served on the home network or Tailscale");
    json(res, 202, await prepare(library.resolve(unit.path), cache));
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/frame", async (_q, res, p, url) => {
    const { unit } = find(p);
    if (unit.format !== "video") throw new HttpError(404, "not a video");
    const file = library.resolve(unit.path);
    // ?at=0.1 is a share of the running time (thumbnails, where the length isn't known yet).
    const at = url.searchParams.get("at");
    if (at !== null) {
      const share = Number(at);
      if (!Number.isFinite(share) || share < 0 || share > 1) throw new HttpError(400, "at must be between 0 and 1");
      await sendImage(res, url, `frame:${version(unit)}:at${share}`,
        async () => ({ type: "image/jpeg", data: await frame(file, (await probe(file)).duration * share, cache) }));
      return;
    }
    const t = Number(url.searchParams.get("t") ?? 0);
    if (!Number.isFinite(t) || t < 0) throw new HttpError(400, "t must be seconds");
    await sendImage(res, url, `frame:${version(unit)}:${t}`, async () => ({ type: "image/jpeg", data: await frame(file, t, cache) }));
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/subtitles/:i", async (_q, res, p) => {
    const { unit } = find(p);
    const sub = (unit.subtitles ?? [])[Number(p.i)];
    if (!sub) throw new HttpError(404, "no such subtitle");
    const vtt = await subtitlesVtt(library.resolve(sub));
    res.writeHead(200, { "content-type": "text/vtt; charset=utf-8", "cache-control": "private, max-age=3600" });
    res.end(vtt);
  });

  route("GET", "/api/v1/units/:kind/:slug/:unit/file", (req, res, p) => {
    const { unit } = find(p);
    const types: Record<string, string> = { cbz: "application/vnd.comicbook+zip", zip: "application/zip", pdf: "application/pdf" };
    const type = types[unit.format];
    if (!type) throw new HttpError(404, "this unit has no single file");
    const path = library.resolve(unit.path);
    res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(path.split("/").at(-1)!)}`);
    sendFile(req, res, path, type);
  });

  // --- OPDS ---------------------------------------------------------------------------------
  const atom = (res: ServerResponse, xml: string) => {
    res.writeHead(200, { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "no-store" });
    res.end(xml);
  };
  // A catalog per profile: /opds?profile=sol keeps "?profile=sol" on every link it hands out, so a
  // reader on a trusted network (which sends no user name) still reads as Sol.
  const opdsQ = (url: URL) => {
    const p = url.searchParams.get("profile")?.trim().toLowerCase();
    return p && store.hasProfile(p) ? `?profile=${encodeURIComponent(p)}` : "";
  };
  route("GET", "/opds", (_q, res, _p, url) => atom(res, rootFeed(library, undefined, opdsQ(url))));
  route("GET", "/opds/all", (req, res, _p, url) => atom(res, worksFeed(library, store, "all", undefined, who(req, url), opdsQ(url))));
  route("GET", "/opds/continue", (req, res, _p, url) =>
    atom(res, worksFeed(library, store, "continue", undefined, who(req, url), opdsQ(url))));
  route("GET", "/opds/type/:type", (req, res, p, url) =>
    atom(res, worksFeed(library, store, p.type!, undefined, who(req, url), opdsQ(url))));
  route("GET", "/opds/w/:kind/:slug", async (req, res, p, url) => {
    const w = library.get(`${p.kind}/${p.slug}`);
    if (!w) throw new HttpError(404, "unknown work");
    const counts = new Map<string, number>();
    for (const u of w.units) {
      try { counts.set(u.key, (await openPages(cfg.library, u, cache)).count); } catch { counts.set(u.key, 0); }
    }
    atom(res, workFeed(w, store, counts, undefined, who(req, url), opdsQ(url)));
  });
  route("GET", "/opds/pse/:kind/:slug/:unit/:n", async (req, res, p, url) => {
    const { work, unit } = find(p);
    const profile = who(req, url);
    const pages = await openPages(cfg.library, unit, cache);
    const n = Number(p.n) + 1;                        // PSE counts from 0
    if (!Number.isInteger(n) || n < 1 || n > pages.count) throw new HttpError(404, "no such page");
    const page = await pages.page(n);
    const before = store.forWork(work.id, profile).find((x) => x.unitKey === unit.key);
    if (!before || before.finished || n > before.position || n < before.position - 1) {
      store.save(work.id, unit.key, n, pages.count, "pages", new Date(), profile);
    }
    res.writeHead(200, { "content-type": page.type, "content-length": page.data.length, "cache-control": "private, max-age=86400" });
    res.end(page.data);
  });

  route("GET", "/api/v1/progress", (req, res, _p, url) => {
    const profile = who(req, url);
    const latest = store.latest(profile).filter((p) => library.get(p.workId)).map((p) => ({
      ...p, work: workView(library.get(p.workId)!, false, profile),
    }));
    json(res, 200, { profile, latest, all: store.all(profile) });
  });

  route("PUT", "/api/v1/progress/:kind/:slug/:unit", async (req, res, p) => {
    const { work, unit } = find(p);
    const b = await readJson(req);
    const position = Number(b.position), total = Number(b.total);
    if (!Number.isFinite(position) || !Number.isFinite(total) || position < 0 || total < 0) {
      throw new HttpError(400, "position and total must be numbers");
    }
    const kind = unit.format === "video" ? "video" : "pages";
    json(res, 200, store.save(work.id, unit.key, position, total, kind, new Date(), who(req, new URL(req.url ?? "/", "http://x"))));
  });

  route("GET", "/api/v1/events", (_q, res, _p, url) => {
    json(res, 200, { events: store.events(Number(url.searchParams.get("since") ?? 0)) });
  });

  route("POST", "/api/v1/rescan", (_q, res) => json(res, 200, library.rescan()));

  // --- profiles ----------------------------------------------------------------------------
  // The look fields as the body has them: absent stays absent, so PATCH changes only what it names.
  const look = (b: Record<string, unknown>) => ({
    ...("hue" in b ? { hue: b.hue === null ? null : Number(b.hue) } : {}),
    ...("glyph" in b ? { glyph: b.glyph === null ? null : String(b.glyph) } : {}),
  });

  route("GET", "/api/v1/profiles", (req, res, _p, url) => {
    const stats = store.profileStats();
    json(res, 200, { profiles: store.profiles().map((p) => ({ ...p, stats: stats[p.id] })), current: who(req, url) });
  });

  route("POST", "/api/v1/profiles", async (req, res) => {
    const b = await readJson(req);
    try {
      json(res, 201, store.addProfile(String(b.name ?? ""), look(b)));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  route("PATCH", "/api/v1/profiles/:id", async (req, res, p) => {
    if (!store.hasProfile(p.id!)) throw new HttpError(404, "unknown profile");
    const b = await readJson(req);
    try {
      store.updateProfile(p.id!, { ...("name" in b ? { name: String(b.name ?? "") } : {}), ...look(b) });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    json(res, 200, { profiles: store.profiles() });
  });

  route("DELETE", "/api/v1/profiles/:id", (_q, res, p) => {
    if (!store.hasProfile(p.id!)) throw new HttpError(404, "unknown profile");
    try { store.removeProfile(p.id!); } catch (err) { throw new HttpError(400, (err as Error).message); }
    json(res, 200, { profiles: store.profiles() });
  });

  route("POST", "/api/v1/profiles/:id/use", (_q, res, p) => {
    if (!store.hasProfile(p.id!)) throw new HttpError(404, "unknown profile");
    json(res, 200, { current: p.id }, {
      "set-cookie": `${PROFILE_COOKIE}=${encodeURIComponent(p.id!)}; SameSite=Strict; Path=/; Max-Age=31536000`,
    });
  });

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
    const client = clientOf(req, proxies);
    hardenHeaders(res, client.https);
    try {
      if (!fromTrusted(req) && limiter.blocked(client.ip)) {
        res.setHeader("retry-after", "900");
        throw new HttpError(429, "too many failed attempts; try again later");
      }
      const routed = url.pathname.startsWith("/api/") || url.pathname === "/opds" || url.pathname.startsWith("/opds/")
        || url.pathname === "/mcp" || url.pathname === "/llms.txt";
      if (!routed) {
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
        serveWeb(req, res, url.pathname);
        return;
      }
      const hit = match(req.method ?? "GET", url.pathname);
      if (!hit) throw new HttpError(404, "not found");
      if (!hit.open && !authed(req)) {
        if (presentedCredentials(req)) failed(req, url.pathname);
        if (url.pathname.startsWith("/opds")) res.setHeader("www-authenticate", 'Basic realm="archivist", charset="UTF-8"');
        if (url.pathname === "/mcp") res.setHeader("www-authenticate", 'Bearer realm="archivist"');
        throw new HttpError(401, "token required");
      }
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin && cfg.token && !fromTrusted(req)) {
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
  const backup = () => {
    if (!cfg.backup) return;
    try { store.snapshot(cfg.backup); } catch (err) { console.error("backup failed", err); }
  };
  backup();
  const daily = setInterval(backup, 24 * 3600_000);
  daily.unref();

  return {
    server, library, store,
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      clearInterval(daily);
      server.close(() => { store.close(); resolve(); });
    }),
  };
}
