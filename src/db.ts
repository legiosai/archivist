/**
 * The only state archivist owns: where the owner is in each unit, and what happened (finished a
 * unit, a work arrived) for tools that follow along. node:sqlite, one file under the data folder.
 */
import { DatabaseSync } from "node:sqlite";

export interface Progress {
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
  workId: string;
  unitKey: string | null;
}

/** Pages: the last page. Video: 95 % of the running time (credits are not watched). */
export function isFinished(position: number, total: number, kind: "pages" | "video"): boolean {
  if (total <= 0) return false;
  return kind === "pages" ? position >= total : position / total >= 0.95;
}

type Row = Record<string, unknown>;

function toProgress(r: Row): Progress {
  return {
    workId: String(r.work_id), unitKey: String(r.unit_key), position: Number(r.position), total: Number(r.total),
    finished: Number(r.finished) === 1, updatedAt: String(r.updated_at),
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS progress (
        work_id TEXT NOT NULL, unit_key TEXT NOT NULL, position REAL NOT NULL, total REAL NOT NULL,
        finished INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (work_id, unit_key));
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL,
        work_id TEXT NOT NULL, unit_key TEXT);
    `);
  }

  save(workId: string, unitKey: string, position: number, total: number, kind: "pages" | "video",
       now = new Date()): { progress: Progress; newlyFinished: boolean } {
    const before = this.db.prepare("SELECT finished FROM progress WHERE work_id = ? AND unit_key = ?")
      .get(workId, unitKey) as Row | undefined;
    const finished = isFinished(position, total, kind) || Number(before?.finished ?? 0) === 1;
    const at = now.toISOString();
    this.db.prepare(`INSERT INTO progress (work_id, unit_key, position, total, finished, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (work_id, unit_key) DO UPDATE SET position = excluded.position,
      total = excluded.total, finished = excluded.finished, updated_at = excluded.updated_at`)
      .run(workId, unitKey, position, total, finished ? 1 : 0, at);
    const newlyFinished = finished && Number(before?.finished ?? 0) !== 1;
    if (newlyFinished) this.event("finished", workId, unitKey, now);
    return { progress: { workId, unitKey, position, total, finished, updatedAt: at }, newlyFinished };
  }

  forWork(workId: string): Progress[] {
    return (this.db.prepare("SELECT * FROM progress WHERE work_id = ?").all(workId) as Row[]).map(toProgress);
  }

  all(): Progress[] {
    return (this.db.prepare("SELECT * FROM progress ORDER BY updated_at DESC").all() as Row[]).map(toProgress);
  }

  /** The unit last touched in each work, newest first: the "continue" shelf. */
  latest(): Progress[] {
    const seen = new Set<string>();
    return this.all().filter((p) => !seen.has(p.workId) && seen.add(p.workId));
  }

  event(type: Event["type"], workId: string, unitKey: string | null = null, now = new Date()): void {
    this.db.prepare("INSERT INTO events (at, type, work_id, unit_key) VALUES (?, ?, ?, ?)")
      .run(now.toISOString(), type, workId, unitKey);
  }

  events(since = 0, limit = 500): Event[] {
    return (this.db.prepare("SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?").all(since, limit) as Row[])
      .map((r) => ({ id: Number(r.id), at: String(r.at), type: r.type as Event["type"], workId: String(r.work_id),
        unitKey: r.unit_key === null ? null : String(r.unit_key) }));
  }

  close(): void {
    this.db.close();
  }
}
