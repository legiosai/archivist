/**
 * The only state archivist owns: who reads (profiles), where each one is in each unit, and what
 * happened (finished a unit, a work arrived) for tools that follow along. node:sqlite, one file
 * under the data folder. The first profile is the owner's; a household adds more.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const OWNER = "owner";

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  /** The avatar: a hue (0–359) for its colors and one emoji; null = picked from the id / the initial. */
  hue: number | null;
  glyph: string | null;
}

export interface Look {
  hue?: number | null;
  glyph?: string | null;
}

export interface ProfileStats {
  /** Works with something started and not finished. */
  inProgress: number;
  finishedUnits: number;
  lastAt: string | null;
}

/** A hue and one emoji (a single grapheme, no spaces or markup), or an error. */
export function cleanLook(look: Look): Look {
  const out: Look = {};
  if (look.hue !== undefined) {
    if (look.hue === null) out.hue = null;
    else if (!Number.isInteger(look.hue) || look.hue < 0 || look.hue > 359) throw new Error("hue must be a whole number from 0 to 359");
    else out.hue = look.hue;
  }
  if (look.glyph !== undefined) {
    const g = typeof look.glyph === "string" ? look.glyph.trim() : "";
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(g)];
    if (!g) out.glyph = null;
    else if (graphemes.length !== 1 || g.length > 16 || /[\s<>&"'\p{Cc}]/u.test(g)) throw new Error("glyph must be a single emoji or letter");
    else out.glyph = g;
  }
  return out;
}

export interface Progress {
  profile: string;
  workId: string;
  unitKey: string;
  position: number;
  total: number;
  finished: boolean;
  updatedAt: string;
}

/** What TMDB or AniList say about a work, cached; `match` says how it was found. */
export interface Details {
  source: "tmdb" | "anilist";
  /** "movie/603", "tv/1399", "anime/30002", "manga/30002". */
  extId: string;
  title: string | null;
  overview: string | null;
  genres: string[];
  credits: string[];
  runtime: number | null;
  year: number | null;
  url: string | null;
  posterUrl: string | null;
  /** A wide image (TMDB's backdrop, AniList's banner), for the top of a page. */
  backdropUrl?: string | null;
}

export interface MetaRow {
  workId: string;
  /** "id": from the yaml's ids; "auto": by title and year; "owner": picked by hand; "none": nothing found or turned off. */
  match: "id" | "auto" | "owner" | "none";
  details: Details | null;
  /** The downloaded poster and backdrop, under the cache folder. */
  posterFile: string | null;
  backdropFile?: string | null;
  fetchedAt: string;
}

/** A profile's audio and subtitles for a work, by language so they carry from one episode to the next. */
export interface TrackChoice {
  audio: { lang: string | null; n: number } | null;
  subtitle: { lang: string | null; label: string | null } | "off" | null;
}

export interface YearStats {
  profile: string;
  year: number;
  years: number[];
  seconds: number;
  pages: number;
  unitsFinished: number;
  worksFinished: string[];
  worksTouched: number;
  daysActive: number;
  longestStreak: number;
  byMonth: { seconds: number; pages: number; finished: number }[];
  byType: Record<string, number>;
  top: { workId: string; seconds: number; pages: number }[];
}

export interface Event {
  id: number;
  at: string;
  type: "finished" | "work_added" | "work_removed";
  profile: string | null;
  workId: string;
  unitKey: string | null;
}

/** Pages: the last page. Video: 95 % of the running time (credits are not watched). */
export function isFinished(position: number, total: number, kind: "pages" | "video"): boolean {
  if (total <= 0) return false;
  return kind === "pages" ? position >= total : position / total >= 0.95;
}

/** A profile id from a name: lowercase ASCII, dashes ("Sol" → "sol", "Ñandú" → "nandu"). */
export function profileId(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

type Row = Record<string, unknown>;

/** The calendar day where the server is (America/Argentina here): "2026-10-06". */
export function localDay(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

function toProgress(r: Row): Progress {
  return {
    profile: String(r.profile), workId: String(r.work_id), unitKey: String(r.unit_key), position: Number(r.position),
    total: Number(r.total), finished: Number(r.finished) === 1, updatedAt: String(r.updated_at),
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string, ownerName = "Yo") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, last_seen TEXT NOT NULL,
        ip TEXT, agent TEXT);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL,
        work_id TEXT NOT NULL, unit_key TEXT);
      CREATE TABLE IF NOT EXISTS meta (work_id TEXT PRIMARY KEY, match TEXT NOT NULL, details TEXT, poster_file TEXT,
        fetched_at TEXT NOT NULL, backdrop_file TEXT);
      CREATE TABLE IF NOT EXISTS tracks (profile TEXT NOT NULL, work_id TEXT NOT NULL, choice TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (profile, work_id));
      CREATE TABLE IF NOT EXISTS activity (profile TEXT NOT NULL, day TEXT NOT NULL, work_id TEXT NOT NULL, unit_key TEXT NOT NULL,
        seconds REAL NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (profile, day, work_id, unit_key));
    `);
    this.migrate();
    this.db.prepare("INSERT OR IGNORE INTO profiles (id, name, created_at) VALUES (?, ?, ?)")
      .run(OWNER, ownerName, new Date().toISOString());
  }

  /** 0.1 had one reader: its progress becomes the owner's, and events learn whose they are. */
  private migrate(): void {
    const cols = (t: string) => (this.db.prepare(`PRAGMA table_info(${t})`).all() as Row[]).map((r) => String(r.name));
    const progress = cols("progress");
    if (progress.length && !progress.includes("profile")) {
      this.db.exec(`ALTER TABLE progress RENAME TO progress_v1;`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS progress (
      profile TEXT NOT NULL, work_id TEXT NOT NULL, unit_key TEXT NOT NULL, position REAL NOT NULL, total REAL NOT NULL,
      finished INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (profile, work_id, unit_key));`);
    if (cols("progress_v1").length) {
      this.db.exec(`INSERT OR IGNORE INTO progress SELECT '${OWNER}', work_id, unit_key, position, total, finished, updated_at
        FROM progress_v1; DROP TABLE progress_v1;`);
    }
    if (!cols("events").includes("profile")) this.db.exec(`ALTER TABLE events ADD COLUMN profile TEXT;`);
    // 0.5: each profile picks its avatar.
    if (!cols("profiles").includes("hue")) this.db.exec(`ALTER TABLE profiles ADD COLUMN hue INTEGER; ALTER TABLE profiles ADD COLUMN glyph TEXT;`);
    // 0.7: a wide image beside the poster.
    if (cols("meta").length && !cols("meta").includes("backdrop_file")) this.db.exec(`ALTER TABLE meta ADD COLUMN backdrop_file TEXT;`);
  }

  // --- profiles ------------------------------------------------------------------------------
  profiles(): Profile[] {
    return (this.db.prepare("SELECT * FROM profiles ORDER BY created_at").all() as Row[])
      .map((r) => ({ id: String(r.id), name: String(r.name), createdAt: String(r.created_at),
        hue: r.hue === null || r.hue === undefined ? null : Number(r.hue), glyph: r.glyph ? String(r.glyph) : null }));
  }

  /** Per profile: works under way, units finished, and when it last read or watched. */
  profileStats(): Record<string, ProfileStats> {
    const rows = this.db.prepare(`SELECT profile, SUM(finished) AS done, MAX(updated_at) AS last,
      COUNT(DISTINCT CASE WHEN finished = 0 THEN work_id END) AS open FROM progress GROUP BY profile`).all() as Row[];
    const out: Record<string, ProfileStats> = {};
    for (const p of this.profiles()) out[p.id] = { inProgress: 0, finishedUnits: 0, lastAt: null };
    for (const r of rows) {
      if (!out[String(r.profile)]) continue;
      out[String(r.profile)] = { inProgress: Number(r.open ?? 0), finishedUnits: Number(r.done ?? 0), lastAt: r.last ? String(r.last) : null };
    }
    return out;
  }

  hasProfile(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM profiles WHERE id = ?").get(id);
  }

  addProfile(name: string, look: Look = {}): Profile {
    const clean = name.trim().slice(0, 40);
    const id = profileId(clean);
    if (!clean || !id) throw new Error("a profile needs a name");
    if (this.hasProfile(id)) throw new Error(`there is already a profile called ${clean}`);
    const { hue = null, glyph = null } = cleanLook(look);
    const at = new Date().toISOString();
    this.db.prepare("INSERT INTO profiles (id, name, created_at, hue, glyph) VALUES (?, ?, ?, ?, ?)").run(id, clean, at, hue, glyph);
    return { id, name: clean, createdAt: at, hue, glyph };
  }

  /** Rename and/or restyle; fields left out stay as they are. The id never changes. */
  updateProfile(id: string, change: { name?: string } & Look): void {
    if (change.name !== undefined) {
      if (!change.name.trim()) throw new Error("a profile needs a name");
      this.db.prepare("UPDATE profiles SET name = ? WHERE id = ?").run(change.name.trim().slice(0, 40), id);
    }
    const look = cleanLook(change);
    if (look.hue !== undefined) this.db.prepare("UPDATE profiles SET hue = ? WHERE id = ?").run(look.hue, id);
    if (look.glyph !== undefined) this.db.prepare("UPDATE profiles SET glyph = ? WHERE id = ?").run(look.glyph, id);
  }

  /** Removes a profile and its progress. The owner's cannot be removed. */
  removeProfile(id: string): void {
    if (id === OWNER) throw new Error("the owner's profile stays");
    this.db.prepare("DELETE FROM progress WHERE profile = ?").run(id);
    this.db.prepare("DELETE FROM activity WHERE profile = ?").run(id);
    this.db.prepare("DELETE FROM tracks WHERE profile = ?").run(id);
    this.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  }

  // --- progress ------------------------------------------------------------------------------
  save(workId: string, unitKey: string, position: number, total: number, kind: "pages" | "video",
       now = new Date(), profile = OWNER): { progress: Progress; newlyFinished: boolean } {
    const before = this.db.prepare("SELECT finished, position, updated_at FROM progress WHERE profile = ? AND work_id = ? AND unit_key = ?")
      .get(profile, workId, unitKey) as Row | undefined;
    this.track(profile, workId, unitKey, kind, before, position, now);
    const finished = isFinished(position, total, kind) || Number(before?.finished ?? 0) === 1;
    const at = now.toISOString();
    this.db.prepare(`INSERT INTO progress (profile, work_id, unit_key, position, total, finished, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (profile, work_id, unit_key) DO UPDATE SET position = excluded.position,
      total = excluded.total, finished = excluded.finished, updated_at = excluded.updated_at`)
      .run(profile, workId, unitKey, position, total, finished ? 1 : 0, at);
    const newlyFinished = finished && Number(before?.finished ?? 0) !== 1;
    if (newlyFinished) this.event("finished", workId, unitKey, now, profile);
    return { progress: { profile, workId, unitKey, position, total, finished, updatedAt: at }, newlyFinished };
  }

  /**
   * Time watched and pages read, by day, for "Tu año": what a save moved forward since the last one.
   * A jump (seeking ahead, skipping pages) counts only as much as the clock allows.
   */
  private track(profile: string, workId: string, unitKey: string, kind: "pages" | "video", before: Row | undefined,
                position: number, now: Date): void {
    let seconds = 0, pages = 0;
    if (!before) {
      if (kind === "video" && position > 0 && position <= 30) seconds = position;
      if (kind === "pages" && position >= 1 && position <= 3) pages = position;
    } else {
      const moved = position - Number(before.position);
      const wall = (now.getTime() - Date.parse(String(before.updated_at))) / 1000;
      if (kind === "video" && moved > 0 && moved <= Math.min(3600, wall + 15)) seconds = moved;
      if (kind === "pages" && moved > 0 && moved <= Math.min(40, Math.max(2, wall / 2))) pages = Math.round(moved);
    }
    if (!seconds && !pages) return;
    this.db.prepare(`INSERT INTO activity (profile, day, work_id, unit_key, seconds, pages) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (profile, day, work_id, unit_key) DO UPDATE SET seconds = seconds + excluded.seconds, pages = pages + excluded.pages`)
      .run(profile, localDay(now), workId, unitKey, seconds, pages);
  }

  /**
   * A profile's year: time watched, pages read, what was finished, by month and by type. Progress
   * from before 0.6 (no activity log) counts once, on the day it was last saved: a finished video
   * as its running time, pages as the page reached.
   */
  stats(profile: string, year: number, lookup: (workId: string) => { type: string; units: number } | undefined): YearStats {
    const rows = this.db.prepare("SELECT day, work_id, seconds, pages FROM activity WHERE profile = ?").all(profile) as Row[];
    const logged = new Set((this.db.prepare("SELECT DISTINCT work_id || '|' || unit_key AS k FROM activity WHERE profile = ?")
      .all(profile) as Row[]).map((r) => String(r.k)));
    const items: { day: string; workId: string; seconds: number; pages: number }[] = rows.map((r) => ({
      day: String(r.day), workId: String(r.work_id), seconds: Number(r.seconds), pages: Number(r.pages) }));
    for (const p of this.all(profile)) {
      if (logged.has(`${p.workId}|${p.unitKey}`)) continue;
      const video = p.unitKey === "film" || /^s\d+e\d+$/.test(p.unitKey);
      items.push({ day: localDay(new Date(p.updatedAt)), workId: p.workId,
        seconds: video ? (p.finished ? p.total : p.position) : 0, pages: video ? 0 : Math.round(p.finished ? p.total : p.position) });
    }
    const finishedEvents = this.db.prepare("SELECT at, work_id, unit_key FROM events WHERE type = 'finished' AND profile = ?")
      .all(profile) as Row[];
    const years = new Set<number>([...items.map((i) => Number(i.day.slice(0, 4))),
      ...finishedEvents.map((e) => Number(localDay(new Date(String(e.at))).slice(0, 4)))]);
    const prefix = `${year}-`;
    const byMonth = Array.from({ length: 12 }, () => ({ seconds: 0, pages: 0, finished: 0 }));
    const perWork = new Map<string, { seconds: number; pages: number }>();
    const days = new Set<string>();
    let seconds = 0, pages = 0;
    for (const i of items) {
      if (!i.day.startsWith(prefix)) continue;
      const m = byMonth[Number(i.day.slice(5, 7)) - 1]!;
      m.seconds += i.seconds;
      m.pages += i.pages;
      seconds += i.seconds;
      pages += i.pages;
      days.add(i.day);
      const w = perWork.get(i.workId) ?? { seconds: 0, pages: 0 };
      w.seconds += i.seconds;
      w.pages += i.pages;
      perWork.set(i.workId, w);
    }
    let unitsFinished = 0;
    const lastFinish = new Map<string, string>();
    for (const e of finishedEvents) {
      const day = localDay(new Date(String(e.at)));
      if (!day.startsWith(prefix)) continue;
      unitsFinished++;
      byMonth[Number(day.slice(5, 7)) - 1]!.finished++;
      lastFinish.set(String(e.work_id), day);
    }
    // A work counts as finished this year when all its units are finished and the last of them was this year.
    const finishedUnits = new Map<string, number>();
    for (const p of this.all(profile)) if (p.finished) finishedUnits.set(p.workId, (finishedUnits.get(p.workId) ?? 0) + 1);
    const worksFinished = [...lastFinish.entries()]
      .filter(([w]) => { const l = lookup(w); return !!l && l.units > 0 && (finishedUnits.get(w) ?? 0) >= l.units; })
      .sort((a, b) => b[1].localeCompare(a[1])).map(([w]) => w);
    const byType: Record<string, number> = {};
    for (const w of perWork.keys()) {
      const t = lookup(w)?.type;
      if (t) byType[t] = (byType[t] ?? 0) + 1;
    }
    const sorted = [...days].sort();
    let longestStreak = 0, run = 0, prev = "";
    for (const d of sorted) {
      run = prev && Date.parse(`${d}T12:00:00Z`) - Date.parse(`${prev}T12:00:00Z`) === 86_400_000 ? run + 1 : 1;
      longestStreak = Math.max(longestStreak, run);
      prev = d;
    }
    const top = [...perWork.entries()].map(([workId, v]) => ({ workId, ...v }))
      .sort((a, b) => (b.seconds + b.pages * 60) - (a.seconds + a.pages * 60)).slice(0, 5);
    return { profile, year, years: [...years].filter(Boolean).sort((a, b) => b - a), seconds: Math.round(seconds), pages, unitsFinished,
      worksFinished, worksTouched: perWork.size, daysActive: days.size, longestStreak, byMonth, byType, top };
  }

  // --- metadata (TMDB, AniList) ----------------------------------------------------------------
  meta(workId: string): MetaRow | null {
    const r = this.db.prepare("SELECT * FROM meta WHERE work_id = ?").get(workId) as Row | undefined;
    if (!r) return null;
    return { workId, match: String(r.match) as MetaRow["match"], details: r.details ? JSON.parse(String(r.details)) as Details : null,
      posterFile: r.poster_file ? String(r.poster_file) : null, backdropFile: r.backdrop_file ? String(r.backdrop_file) : null,
      fetchedAt: String(r.fetched_at) };
  }

  setMeta(row: Omit<MetaRow, "fetchedAt">, now = new Date()): void {
    this.db.prepare(`INSERT INTO meta (work_id, match, details, poster_file, backdrop_file, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (work_id) DO UPDATE SET match = excluded.match, details = excluded.details, poster_file = excluded.poster_file,
      backdrop_file = excluded.backdrop_file, fetched_at = excluded.fetched_at`)
      .run(row.workId, row.match, row.details ? JSON.stringify(row.details) : null, row.posterFile, row.backdropFile ?? null, now.toISOString());
  }

  forgetMeta(workId: string): void {
    this.db.prepare("DELETE FROM meta WHERE work_id = ?").run(workId);
  }

  // --- audio and subtitles, per profile and work ------------------------------------------------
  tracks(profile: string, workId: string): TrackChoice | null {
    const r = this.db.prepare("SELECT choice FROM tracks WHERE profile = ? AND work_id = ?").get(profile, workId) as Row | undefined;
    return r ? JSON.parse(String(r.choice)) as TrackChoice : null;
  }

  setTracks(profile: string, workId: string, choice: TrackChoice, now = new Date()): void {
    this.db.prepare(`INSERT INTO tracks (profile, work_id, choice, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (profile, work_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`)
      .run(profile, workId, JSON.stringify(choice), now.toISOString());
  }

  forWork(workId: string, profile = OWNER): Progress[] {
    return (this.db.prepare("SELECT * FROM progress WHERE profile = ? AND work_id = ?").all(profile, workId) as Row[])
      .map(toProgress);
  }

  all(profile = OWNER): Progress[] {
    return (this.db.prepare("SELECT * FROM progress WHERE profile = ? ORDER BY updated_at DESC").all(profile) as Row[])
      .map(toProgress);
  }

  /** The unit last touched in each work, newest first: the "continue" shelf. */
  latest(profile = OWNER): Progress[] {
    const seen = new Set<string>();
    return this.all(profile).filter((p) => !seen.has(p.workId) && seen.add(p.workId));
  }

  // --- browser sessions ----------------------------------------------------------------------
  // The cookie carries a random id, never the token; only its hash is stored, so a copy of the
  // database can't log anyone in. Sessions last SESSION_DAYS from their last use.
  static readonly SESSION_DAYS = 90;

  private static hash(id: string): string {
    return createHash("sha256").update(id).digest("hex");
  }

  createSession(ip: string, agent: string, now = new Date()): string {
    const id = randomBytes(32).toString("base64url");
    const at = now.toISOString();
    this.db.prepare("INSERT INTO sessions (hash, created_at, last_seen, ip, agent) VALUES (?, ?, ?, ?, ?)")
      .run(Store.hash(id), at, at, ip, agent.slice(0, 200));
    return id;
  }

  checkSession(id: string | undefined, now = new Date()): boolean {
    if (!id) return false;
    const row = this.db.prepare("SELECT last_seen FROM sessions WHERE hash = ?").get(Store.hash(id)) as Row | undefined;
    if (!row) return false;
    const age = now.getTime() - Date.parse(String(row.last_seen));
    if (age > Store.SESSION_DAYS * 86_400_000) {
      this.endSession(id);
      return false;
    }
    if (age > 3_600_000) this.db.prepare("UPDATE sessions SET last_seen = ? WHERE hash = ?").run(now.toISOString(), Store.hash(id));
    return true;
  }

  endSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(Store.hash(id));
  }

  sessions(): { created_at: string; last_seen: string; ip: string; agent: string }[] {
    return this.db.prepare("SELECT created_at, last_seen, ip, agent FROM sessions ORDER BY last_seen DESC").all() as never;
  }

  endAllSessions(): number {
    return Number(this.db.prepare("DELETE FROM sessions").run().changes);
  }

  // --- events --------------------------------------------------------------------------------
  event(type: Event["type"], workId: string, unitKey: string | null = null, now = new Date(), profile: string | null = null): void {
    this.db.prepare("INSERT INTO events (at, type, work_id, unit_key, profile) VALUES (?, ?, ?, ?, ?)")
      .run(now.toISOString(), type, workId, unitKey, profile);
  }

  events(since = 0, limit = 500): Event[] {
    return (this.db.prepare("SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?").all(since, limit) as Row[])
      .map((r) => ({ id: Number(r.id), at: String(r.at), type: r.type as Event["type"],
        profile: r.profile === null || r.profile === undefined ? null : String(r.profile), workId: String(r.work_id),
        unitKey: r.unit_key === null ? null : String(r.unit_key) }));
  }

  /**
   * A consistent copy of the database (VACUUM INTO, safe while the server runs) named by date,
   * keeping the newest `keep`. Progress is the one thing the folders can't give back.
   */
  snapshot(dir: string, keep = 14, now = new Date()): string {
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `archivist-${now.toISOString().slice(0, 10)}.db`);
    rmSync(out, { force: true });
    this.db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    const old = readdirSync(dir).filter((f) => /^archivist-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(keep);
    for (const f of old) rmSync(join(dir, f), { force: true });
    return out;
  }

  close(): void {
    this.db.close();
  }
}
