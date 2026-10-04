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
    this.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  }

  // --- progress ------------------------------------------------------------------------------
  save(workId: string, unitKey: string, position: number, total: number, kind: "pages" | "video",
       now = new Date(), profile = OWNER): { progress: Progress; newlyFinished: boolean } {
    const before = this.db.prepare("SELECT finished FROM progress WHERE profile = ? AND work_id = ? AND unit_key = ?")
      .get(profile, workId, unitKey) as Row | undefined;
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
