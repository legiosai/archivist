import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { trustedNetworks } from "../src/config.ts";
import { scan } from "../src/library/scan.ts";
import { openPages } from "../src/media/pages.ts";
import { Metadata, norm, providers, score } from "../src/meta.ts";
import { Store } from "../src/db.ts";
import { createApp, imageExt, langOfFile, type App } from "../src/server.ts";
import { PNG, makeZip, tempLibrary } from "./helpers.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

/** A pretend TMDB and AniList: answers by URL, and counts what was asked. */
function fakeFetch(asked: string[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(init?.body ? `${url} ${init.body}` : url);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url.includes("/search/movie")) {
      return ok({ results: [
        { id: 1, title: "Los otros", original_title: "The Others", release_date: "2001-08-02", poster_path: "/others.jpg", overview: "Grace…" },
        { id: 2, title: "Los otros", original_title: "Los otros", release_date: "1974-01-01", poster_path: null },
      ] });
    }
    if (url.includes("/movie/1?")) {
      const es = url.includes("language=es-AR");
      return ok({ id: 1, title: "Los otros", overview: es ? "" : "Grace, in a dark house…", runtime: 104, release_date: "2001-08-02",
        poster_path: "/others.jpg", backdrop_path: "/wide.jpg", genres: [{ name: "Terror" }, { name: "Misterio" }],
        credits: { crew: [{ job: "Director", name: "Alejandro Amenábar" }, { job: "Writer", name: "X" }] } });
    }
    if (url.startsWith("https://image.tmdb.org/")) return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    if (url.startsWith("https://graphql.anilist.co")) {
      const media = { id: 30002, siteUrl: "https://anilist.co/manga/30002", title: { romaji: "Berserk", english: "Berserk", native: "ベルセルク" },
        description: "Guts, a former mercenary…<br><br>(Source: x)", genres: ["Action", "Drama"], coverImage: { extraLarge: "https://s4.anilist.co/b.jpg" },
        startDate: { year: 1989 }, duration: null, studios: { nodes: [] },
        staff: { edges: [{ role: "Story & Art", node: { name: { full: "Kentarou Miura" } } }] } };
      return ok({ data: String(init?.body).includes("Page(") ? { Page: { media: [media] } } : { Media: media } });
    }
    if (url.startsWith("https://s4.anilist.co/")) return new Response(PNG, { headers: { "content-type": "image/png" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("posters on disk", () => {
  it("finds a work's poster, and never takes it for a page", async () => {
    const root = tempLibrary({
      "pages/berserk/poster.jpg": JPEG, "pages/berserk/001.png": PNG, "pages/berserk/002.png": PNG,
      "pages/solo.cbz": makeZip([["1.png", PNG]]), "pages/solo-poster.png": PNG,
      "video/los-otros.mkv": "x", "video/los-otros-poster.webp": "x",
      "video/dark/S01E01.mkv": "x", "video/dark/folder.png": PNG,
      "video/dark/work.yaml": "title: Dark\ntype: series\noverview: Un pueblo.\ngenres: [Drama, Misterio]\nstudio: W&B\n",
    });
    const works = new Map(scan(root).map((w) => [w.id, w]));
    expect(works.get("pages/berserk")!.poster).toBe("pages/berserk/poster.jpg");
    expect(works.get("pages/solo")!.poster).toBe("pages/solo-poster.png");
    expect(works.get("video/los-otros")!.poster).toBe("video/los-otros-poster.webp");
    expect(works.get("video/dark")!.poster).toBe("video/dark/folder.png");
    expect(works.get("video/dark")!.notes).toEqual({ overview: "Un pueblo.", genres: ["Drama", "Misterio"], credits: ["W&B"] });
    const pages = await openPages(root, works.get("pages/berserk")!.units[0]!, mkdtempSync(join(tmpdir(), "c-")));
    expect(pages.count).toBe(2);
  });

  it("tells images and subtitle languages apart by their bytes and names", () => {
    expect(imageExt(JPEG)).toBe(".jpg");
    expect(imageExt(PNG)).toBe(".png");
    expect(imageExt(Buffer.from("RIFF0000WEBPVP8 ", "latin1"))).toBe(".webp");
    expect(imageExt(Buffer.from("<svg/>"))).toBeNull();
    expect(langOfFile("video/peli.es.srt")).toBe("es");
    expect(langOfFile("video/dark/S01E01.spa.ass")).toBe("spa");
    expect(langOfFile("video/peli.srt")).toBeNull();
  });
});

describe("metadata", () => {
  const work = { id: "video/los-otros", slug: "los-otros", kind: "video" as const, type: "film" as const, title: "Los otros", year: 2001,
    ids: {}, reading: null, path: "video/los-otros.mkv", units: [] };

  it("matches on title and year, and is off unless turned on", () => {
    expect(norm("¿Los Otros?")).toBe("losotros");
    expect(score(work, { title: "Los otros", alt: [], year: 2001 })).toBe(4);
    expect(score(work, { title: "Los otros", alt: [], year: 1974 })).toBe(2);
    expect(score({ ...work, originalTitle: "The Others" }, { title: "Los Otros", alt: ["The Others"], year: 2002 })).toBe(3);
    expect(providers("")).toEqual([]);
    expect(providers("tmdb, anilist")).toEqual(["tmdb", "anilist"]);
    expect(() => providers("imdb")).toThrow(/unknown provider/);
    const store = new Store(join(mkdtempSync(join(tmpdir(), "m-")), "a.db"));
    expect(new Metadata(store, { providers: ["tmdb"], tmdbToken: null }, tmpdir()).enabled).toEqual([]);
    expect(new Metadata(store, { providers: ["tmdb"], tmdbToken: "k" }, tmpdir()).kindOf({ ...work, type: "comic" })).toBeNull();
  });

  it("finds a film by title and year, keeps the poster, and the Spanish overview falls back to English", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m-"));
    const store = new Store(join(dir, "a.db"));
    const asked: string[] = [];
    const meta = new Metadata(store, { providers: ["tmdb"], tmdbToken: "eyJ.fake" }, dir, fakeFetch(asked));
    const row = await meta.lookup(work);
    expect(row!.match).toBe("auto");
    expect(row!.details).toMatchObject({ extId: "movie/1", runtime: 104, genres: ["Terror", "Misterio"],
      credits: ["Alejandro Amenábar"], overview: "Grace, in a dark house…" });
    expect(existsSync(meta.posterPath(row!.posterFile!))).toBe(true);
    expect(asked.some((u) => u.includes("api_key"))).toBe(false);      // a v4 token goes in the header
    // The same title in another year is not a match.
    expect((await meta.lookup({ ...work, id: "video/x", year: 1990 }))!.match).toBe("none");
  });

  it("finds a manga on AniList by its id, without HTML in the overview", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m-"));
    const meta = new Metadata(new Store(join(dir, "a.db")), { providers: ["anilist"], tmdbToken: null }, dir, fakeFetch());
    const row = await meta.lookup({ ...work, id: "pages/berserk", kind: "pages", type: "manga", title: "Berserk", year: 1989, ids: { anilist: 30002 } });
    expect(row!.match).toBe("id");
    expect(row!.details).toMatchObject({ source: "anilist", extId: "manga/30002", credits: ["Kentarou Miura"],
      overview: "Guts, a former mercenary…\n\n(Source: x)" });
  });
});

let app: App | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function start(files: Record<string, string | Buffer>, metadata = false) {
  const library = tempLibrary(files);
  const data = mkdtempSync(join(tmpdir(), "archivist-data-"));
  app = createApp({ library, data, host: "127.0.0.1", port: 0, token: null, web: join(data, "no-web"), backup: null,
    trusted: trustedNetworks(""), ...(metadata ? { metadata: { providers: ["tmdb", "anilist"], tmdbToken: "k" } } : {}) },
  { fetch: fakeFetch() });
  await new Promise<void>((r) => app!.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { base, library };
}

describe("upgrading", () => {
  it("opens a 0.6 database, whose metadata had no backdrop", () => {
    const file = join(mkdtempSync(join(tmpdir(), "up-")), "a.db");
    const old = new Store(file);
    old.db.exec("DROP TABLE meta; CREATE TABLE meta (work_id TEXT PRIMARY KEY, match TEXT NOT NULL, details TEXT, poster_file TEXT, fetched_at TEXT NOT NULL);");
    old.db.prepare("INSERT INTO meta VALUES ('video/x', 'none', NULL, NULL, '2026-10-06T00:00:00Z')").run();
    old.close();
    const s = new Store(file);
    expect(s.meta("video/x")).toMatchObject({ match: "none", backdropFile: null });
    s.setMeta({ workId: "video/y", match: "auto", details: null, posterFile: "p.jpg", backdropFile: "w.jpg" });
    expect(s.meta("video/y")!.backdropFile).toBe("w.jpg");
  });
});

describe("posters and metadata through the API", () => {
  it("takes a poster upload, serves it as the cover, and gives the cover back on delete", async () => {
    const { base, library } = await start({ "pages/berserk/tomo-01.cbz": makeZip([["001.png", PNG]]),
      "pages/berserk/work.yaml": "title: Berserk\ntype: manga\n" });
    let w = await (await fetch(`${base}/api/v1/works/pages/berserk`)).json();
    expect(w.poster).toBe("auto");
    expect((await fetch(`${base}/api/v1/works/pages/berserk/poster`, { method: "PUT", body: "<svg/>" })).status).toBe(415);
    w = await (await fetch(`${base}/api/v1/works/pages/berserk/poster`, { method: "PUT", body: JPEG })).json();
    expect(w.poster).toBe("file");
    expect(existsSync(join(library, "pages/berserk/poster.jpg"))).toBe(true);
    const cover = await fetch(`${base}${w.cover}`);
    expect(Buffer.from(await cover.arrayBuffer()).equals(JPEG)).toBe(true);
    w = await (await fetch(`${base}/api/v1/works/pages/berserk/poster`, { method: "PUT", body: PNG })).json();
    expect(existsSync(join(library, "pages/berserk/poster.jpg"))).toBe(false);           // one poster at a time
    expect(readFileSync(join(library, "pages/berserk/poster.png")).equals(PNG)).toBe(true);
    w = await (await fetch(`${base}/api/v1/works/pages/berserk/poster`, { method: "DELETE" })).json();
    expect(w.poster).toBe("auto");
    expect(w.unitList).toHaveLength(1);                                                    // the poster never was a page
  });

  it("looks works up in the background, and lets the owner pick or refuse a match", async () => {
    const { base } = await start({ "video/los-otros.mkv": "x", "video/los-otros.yaml": "title: Los otros\nyear: 2001\n",
      "pages/berserk/tomo-01.cbz": makeZip([["001.png", PNG]]), "pages/berserk/work.yaml": "title: Berserk\ntype: manga\nyear: 1989\n",
      "pages/tintin/t1.cbz": makeZip([["001.png", PNG]]), "pages/tintin/work.yaml": "title: Tintín\ntype: comic\n" }, true);
    await app!.metadata.idle();
    const film = await (await fetch(`${base}/api/v1/works/video/los-otros`)).json();
    expect(film.details).toMatchObject({ source: "tmdb", match: "auto", runtime: 104, credits: ["Alejandro Amenábar"] });
    expect(film.poster).toBe("metadata");
    expect(film.backdrop).toMatch(/^\/api\/v1\/works\/video\/los-otros\/backdrop\?v=m/);
    const wide = await fetch(`${base}${film.backdrop}`);
    expect(wide.status).toBe(200);
    expect(Buffer.from(await wide.arrayBuffer()).equals(JPEG)).toBe(true);
    const manga = await (await fetch(`${base}/api/v1/works/pages/berserk`)).json();
    expect(manga.details).toMatchObject({ source: "anilist", match: "auto", genres: ["Action", "Drama"] });
    const comic = await (await fetch(`${base}/api/v1/works/pages/tintin`)).json();
    expect(comic.details.lookup).toBeNull();
    expect(comic.backdrop).toBeNull();                                    // a book with nothing wide to show
    expect((await fetch(`${base}/api/v1/works/pages/tintin/backdrop`)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/works/pages/tintin/meta/search`)).status).toBe(400);
    const found = await (await fetch(`${base}/api/v1/works/video/los-otros/meta/search?q=otros`)).json();
    expect(found.results.map((c: { extId: string }) => c.extId)).toEqual(["movie/1", "movie/2"]);
    const none = await (await fetch(`${base}/api/v1/works/video/los-otros/meta`, { method: "PUT", body: JSON.stringify({ extId: null }) })).json();
    expect(none.details).toMatchObject({ match: "none", overview: null });
    expect(none.poster).toBe("auto");
    const picked = await (await fetch(`${base}/api/v1/works/video/los-otros/meta`, { method: "PUT", body: JSON.stringify({ extId: "movie/1" }) })).json();
    expect(picked.details.match).toBe("owner");
    expect((await fetch(`${base}/api/v1/works/video/los-otros/meta`, { method: "PUT", body: JSON.stringify({ extId: "anime/1" }) })).status).toBe(400);
  });
});
