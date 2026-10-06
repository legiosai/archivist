/**
 * Metadata from TMDB (films and series) and AniList (anime and manga), only where the owner turned
 * it on (ARCHIVIST_METADATA, and a TMDB token for TMDB): the overview, genres, who made it, the
 * running time and a poster, fetched once and kept in the database and the cache folder. It is
 * the one lookup SOUL.md allows, the same a person would do by hand; the pages and the frames
 * never come from anywhere but the owner's files.
 *
 * A work is found by the ids in its yaml (tmdb_movie, tmdb_tv, anilist), else by its title and
 * year, and only when they agree: a wrong poster is worse than none. The owner can pick the right
 * one by hand, or say there is none.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Details, MetaRow, Store } from "./db.ts";
import type { Work } from "./library/scan.ts";

export type Provider = "tmdb" | "anilist";

export interface MetaConfig {
  providers: Provider[];
  /** A TMDB API read access token (v4, "eyJ…") or a v3 API key. */
  tmdbToken: string | null;
}

/** A search result: the details as far as a list shows them, plus the other titles it goes by. */
export interface Candidate extends Details {
  alt: string[];
}

type Fetch = typeof fetch;
type Kind = { source: "tmdb"; kind: "movie" | "tv" } | { source: "anilist"; kind: "anime" | "manga" };

const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w780";
const ANILIST = "https://graphql.anilist.co";
const LANGS = ["es-AR", "es-ES", "en-US"];

/** Lowercase, no accents, letters and digits only: "¿Los Otros?" → "losotros". */
export const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * How well a result fits the work: the title (or the original title) equal counts 2, one inside
 * the other 1; the same year 2, one year off 1. Auto-matching asks for 3: the title and the year.
 */
export function score(w: Pick<Work, "title" | "originalTitle" | "year">, c: Pick<Candidate, "title" | "alt" | "year">): number {
  const ours = [w.title, w.originalTitle].filter((t): t is string => !!t).map(norm).filter(Boolean);
  const theirs = [c.title, ...c.alt].filter((t): t is string => !!t).map(norm).filter(Boolean);
  let s = 0;
  if (ours.some((a) => theirs.includes(a))) s += 2;
  else if (ours.some((a) => theirs.some((b) => a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))))) s += 1;
  if (w.year && c.year) s += w.year === c.year ? 2 : Math.abs(w.year - c.year) === 1 ? 1 : 0;
  return s;
}

const stripHtml = (s: string | null | undefined) =>
  s ? s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim() || null : null;
const yearOf = (date: string | null | undefined) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

export class Metadata {
  private readonly store: Store;
  private readonly cfg: MetaConfig;
  private readonly dir: string;
  private readonly http: Fetch;
  private readonly waiting: Work[] = [];
  private readonly failedAt = new Map<string, number>();
  private running = false;

  constructor(store: Store, cfg: MetaConfig, cacheDir: string, http: Fetch = fetch) {
    this.store = store;
    this.cfg = cfg;
    this.dir = join(cacheDir, "posters");
    this.http = http;
  }

  /** The providers that can answer: TMDB only with a token. */
  get enabled(): Provider[] {
    return this.cfg.providers.filter((p) => p !== "tmdb" || !!this.cfg.tmdbToken);
  }

  /** Where to ask about this work, or null (comics, or the provider is off). */
  kindOf(w: Work): Kind | null {
    const on = new Set(this.enabled);
    if (on.has("anilist") && w.ids.anilist) return { source: "anilist", kind: w.kind === "pages" ? "manga" : "anime" };
    if (on.has("tmdb") && w.ids.tmdb_movie) return { source: "tmdb", kind: "movie" };
    if (on.has("tmdb") && w.ids.tmdb_tv) return { source: "tmdb", kind: "tv" };
    if (w.type === "film") return on.has("tmdb") ? { source: "tmdb", kind: "movie" } : null;
    if (w.type === "series") return on.has("tmdb") ? { source: "tmdb", kind: "tv" } : null;
    if (w.type === "anime") return on.has("anilist") ? { source: "anilist", kind: "anime" } : on.has("tmdb") ? { source: "tmdb", kind: "tv" } : null;
    if (w.type === "manga") return on.has("anilist") ? { source: "anilist", kind: "manga" } : null;
    return null;
  }

  // --- TMDB -------------------------------------------------------------------------------------
  private async tmdb<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = this.cfg.tmdbToken!;
    const bearer = token.startsWith("eyJ");
    const qs = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: token }) });
    const r = await this.http(`${TMDB}${path}?${qs}`, { headers: bearer ? { authorization: `Bearer ${token}`, accept: "application/json" } : {},
      signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    return (await r.json()) as T;
  }

  private async tmdbDetails(kind: "movie" | "tv", id: string): Promise<Details> {
    type Res = { id: number; title?: string; name?: string; overview?: string; genres?: { name: string }[]; runtime?: number;
      episode_run_time?: number[]; release_date?: string; first_air_date?: string; poster_path?: string | null;
      created_by?: { name: string }[]; credits?: { crew?: { job: string; name: string }[] } };
    // The overview in Spanish when TMDB has it, else in English; everything else from the first answer.
    const r: Res = await this.tmdb<Res>(`/${kind}/${id}`, { language: LANGS[0]!, append_to_response: "credits" });
    for (const language of LANGS.slice(1)) {
      if (r.overview) break;
      const other: Res = await this.tmdb<Res>(`/${kind}/${id}`, { language });
      r.overview = other.overview;
    }
    const credits = kind === "movie"
      ? (r.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name)
      : (r.created_by ?? []).map((c) => c.name);
    return {
      source: "tmdb", extId: `${kind}/${r.id}`, title: r.title ?? r.name ?? null, overview: r.overview || null,
      genres: (r.genres ?? []).map((g) => g.name), credits: [...new Set(credits)].slice(0, 4),
      runtime: r.runtime || r.episode_run_time?.[0] || null, year: yearOf(r.release_date ?? r.first_air_date),
      url: `https://www.themoviedb.org/${kind}/${r.id}`, posterUrl: r.poster_path ? `${TMDB_IMG}${r.poster_path}` : null,
    };
  }

  private async tmdbSearch(kind: "movie" | "tv", q: string): Promise<Candidate[]> {
    type Hit = { id: number; title?: string; name?: string; original_title?: string; original_name?: string; overview?: string;
      release_date?: string; first_air_date?: string; poster_path?: string | null };
    const r = await this.tmdb<{ results?: Hit[] }>(`/search/${kind}`, { query: q, language: "es-AR", include_adult: "false" });
    return (r.results ?? []).slice(0, 10).map((h) => ({
      source: "tmdb", extId: `${kind}/${h.id}`, title: h.title ?? h.name ?? null, overview: h.overview || null, genres: [], credits: [],
      runtime: null, year: yearOf(h.release_date ?? h.first_air_date), url: `https://www.themoviedb.org/${kind}/${h.id}`,
      posterUrl: h.poster_path ? `${TMDB_IMG}${h.poster_path}` : null, alt: [h.original_title ?? h.original_name ?? ""].filter(Boolean),
    }));
  }

  // --- AniList ------------------------------------------------------------------------------------
  private static readonly MEDIA = `id siteUrl title { romaji english native } description(asHtml: false) genres
    coverImage { extraLarge } startDate { year } duration studios(isMain: true) { nodes { name } }
    staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }`;

  private async anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const r = await this.http(ANILIST, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`AniList ${r.status}`);
    const body = (await r.json()) as { data?: T; errors?: { message: string }[] };
    if (!body.data) throw new Error(`AniList: ${body.errors?.[0]?.message ?? "no data"}`);
    return body.data;
  }

  private static fromAnilist(kind: "anime" | "manga", m: {
    id: number; siteUrl?: string; title?: { romaji?: string; english?: string; native?: string }; description?: string; genres?: string[];
    coverImage?: { extraLarge?: string }; startDate?: { year?: number }; duration?: number;
    studios?: { nodes?: { name: string }[] }; staff?: { edges?: { role: string; node: { name: { full: string } } }[] };
  }): Candidate {
    const credits = kind === "anime"
      ? (m.studios?.nodes ?? []).map((n) => n.name)
      : (m.staff?.edges ?? []).filter((e) => /story|art/i.test(e.role)).map((e) => e.node.name.full);
    return {
      source: "anilist", extId: `${kind}/${m.id}`, title: m.title?.english || m.title?.romaji || null,
      overview: stripHtml(m.description), genres: m.genres ?? [], credits: [...new Set(credits)].slice(0, 3),
      runtime: kind === "anime" ? m.duration || null : null, year: m.startDate?.year ?? null, url: m.siteUrl ?? null,
      posterUrl: m.coverImage?.extraLarge ?? null, alt: [m.title?.romaji, m.title?.native].filter((t): t is string => !!t),
    };
  }

  private async anilistDetails(kind: "anime" | "manga", id: string): Promise<Details> {
    const r = await this.anilist<{ Media: Parameters<typeof Metadata.fromAnilist>[1] }>(
      `query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${Metadata.MEDIA} } }`,
      { id: Number(id), type: kind.toUpperCase() });
    const { alt: _alt, ...details } = Metadata.fromAnilist(kind, r.Media);
    return details;
  }

  private async anilistSearch(kind: "anime" | "manga", q: string): Promise<Candidate[]> {
    const r = await this.anilist<{ Page: { media: Parameters<typeof Metadata.fromAnilist>[1][] } }>(
      `query ($q: String, $type: MediaType) { Page(perPage: 10) { media(search: $q, type: $type, sort: SEARCH_MATCH) { ${Metadata.MEDIA} } } }`,
      { q, type: kind.toUpperCase() });
    return r.Page.media.map((m) => Metadata.fromAnilist(kind, m));
  }

  // --- the work's metadata ------------------------------------------------------------------------
  private details(k: Kind, id: string): Promise<Details> {
    return k.source === "tmdb" ? this.tmdbDetails(k.kind, id) : this.anilistDetails(k.kind, id);
  }

  /** Results for the owner to pick from, best first. */
  async search(w: Work, q?: string): Promise<Candidate[]> {
    const k = this.kindOf(w);
    if (!k) return [];
    const query = (q ?? "").trim() || w.originalTitle || w.title;
    const found = k.source === "tmdb" ? await this.tmdbSearch(k.kind, query) : await this.anilistSearch(k.kind, query);
    return found.map((c, i) => ({ c, s: score(w, c), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
  }

  /** The poster, downloaded once into the cache: its file name, or null. */
  private async poster(url: string | null): Promise<string | null> {
    if (!url) return null;
    const name = `${createHash("sha1").update(url).digest("hex").slice(0, 24)}.jpg`;
    const file = join(this.dir, name);
    if (existsSync(file)) return name;
    const r = await this.http(url, { signal: AbortSignal.timeout(30_000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/")) return null;
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
    writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    renameSync(tmp, file);
    return name;
  }

  /**
   * A search result's poster, small, for the owner's picker: fetched by the server so the page keeps
   * its strict image policy and the browser never talks to TMDB or AniList. Only their image hosts.
   */
  async thumb(url: string): Promise<{ type: string; data: Buffer } | null> {
    const small = url.startsWith(TMDB_IMG) ? url.replace("/w780/", "/w185/") : url;
    if (!small.startsWith("https://image.tmdb.org/t/p/") && !/^https:\/\/s\d+\.anilist\.co\//.test(small)) return null;
    const r = await this.http(small, { signal: AbortSignal.timeout(15_000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/")) return null;
    return { type, data: Buffer.from(await r.arrayBuffer()) };
  }

  posterPath(name: string): string {
    return join(this.dir, name);
  }

  private async keep(w: Work, match: MetaRow["match"], details: Details | null): Promise<MetaRow> {
    const posterFile = details ? await this.poster(details.posterUrl).catch(() => null) : null;
    this.store.setMeta({ workId: w.id, match, details, posterFile });
    return this.store.meta(w.id)!;
  }

  /** By the yaml's id, else by title and year; "none" when nothing fits well enough. */
  async lookup(w: Work): Promise<MetaRow | null> {
    const k = this.kindOf(w);
    if (!k) return null;
    const id = k.source === "anilist" ? w.ids.anilist : k.kind === "movie" ? w.ids.tmdb_movie : w.ids.tmdb_tv;
    if (id) return this.keep(w, "id", await this.details(k, String(id)));
    const found = await this.search(w);
    const best = found[0];
    const fits = best && score(w, best) >= (w.year ? 3 : 2) && (w.year || found.filter((c) => score(w, c) >= 2).length === 1);
    if (!fits) return this.keep(w, "none", null);
    return this.keep(w, "auto", await this.details(k, best.extId.split("/")[1]!));
  }

  /** The owner's pick: "movie/603", "anime/30002"… */
  async choose(w: Work, extId: string): Promise<MetaRow> {
    const k = this.kindOf(w);
    const [kind, id] = extId.split("/");
    if (!k || !id || !/^\d+$/.test(id) || kind !== k.kind) throw new Error(`not a ${k?.kind ?? "known"} id: ${extId}`);
    return this.keep(w, "owner", await this.details(k, id));
  }

  /** The owner says it is none of them: no metadata, and no more automatic tries. */
  none(w: Work): void {
    this.store.setMeta({ workId: w.id, match: "none", details: null, posterFile: null });
  }

  /** Looks up, in the background and one at a time, the works never looked up (a failure waits an hour). */
  queue(works: Work[]): void {
    if (!this.enabled.length) return;
    const now = Date.now();
    for (const w of works) {
      if (!this.kindOf(w) || this.store.meta(w.id) || this.waiting.some((x) => x.id === w.id)) continue;
      if (now - (this.failedAt.get(w.id) ?? 0) < 3_600_000) continue;
      this.waiting.push(w);
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let w = this.waiting.shift(); w; w = this.waiting.shift()) {
        try {
          await this.lookup(w);
        } catch (err) {
          this.failedAt.set(w.id, Date.now());
          console.warn(`archivist: metadata for ${w.id} failed: ${(err as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      this.running = false;
    }
  }

  /** Waits for the background queue (tests). */
  async idle(): Promise<void> {
    while (this.running || this.waiting.length) await new Promise((r) => setTimeout(r, 20));
  }
}

/** ARCHIVIST_METADATA ("tmdb,anilist"): which providers may be asked. Nothing by default. */
export function providers(spec: string | undefined): Provider[] {
  const items = (spec ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const i of items) if (i !== "tmdb" && i !== "anilist") throw new Error(`ARCHIVIST_METADATA: unknown provider ${i} (tmdb, anilist)`);
  return [...new Set(items)] as Provider[];
}
