// The UI talks to the same API as any tool. After login the browser holds a session cookie
// (HttpOnly, revocable from Perfiles); the token itself never leaves the login form.

export type WorkType = "film" | "series" | "anime" | "manga" | "comic";

export interface Progress {
  workId: string;
  unitKey: string;
  position: number;
  total: number;
  finished: boolean;
  updatedAt: string;
}

export interface WorkSummary {
  id: string;
  slug: string;
  kind: "video" | "pages" | "stills";
  type: WorkType;
  title: string;
  year: number | null;
  originalTitle: string | null;
  reading: "rtl" | "ltr" | "vertical" | null;
  units: number;
  finished: number;
  last: Progress | null;
  cover: string | null;
  /** Where the cover comes from: the work's own poster file, TMDB or AniList, or a frame or first page. */
  poster: "file" | "metadata" | "auto" | null;
}

export interface Details {
  overview: string | null;
  genres: string[];
  credits: string[];
  /** Minutes (per episode for a series). */
  runtime: number | null;
  source: "tmdb" | "anilist" | null;
  url: string | null;
  extId: string | null;
  remoteTitle: string | null;
  match: "id" | "auto" | "owner" | "none" | null;
  /** The provider this work can be looked up in, if any is on. */
  lookup: "tmdb" | "anilist" | null;
}

export interface Candidate {
  source: "tmdb" | "anilist";
  extId: string;
  title: string | null;
  overview: string | null;
  year: number | null;
  posterUrl: string | null;
  url: string | null;
}

export interface UnitView {
  key: string;
  label: string;
  format: "video" | "cbz" | "zip" | "pdf" | "images";
  season: number | null;
  episode: number | null;
  volume: number | null;
  subtitles: number;
  progress: Progress | null;
}

export interface WorkDetail extends WorkSummary {
  unitList: UnitView[];
  details: Details;
}

export interface AudioTrack {
  n: number;
  lang: string | null;
  title: string | null;
  codec: string;
  channels: number | null;
  default: boolean;
}

export interface SubtitleTrack {
  index: number | string;
  label: string | null;
  lang: string | null;
  forced: boolean;
  kind: "file" | "embedded";
  href: string;
}

export interface VideoInfo {
  duration: number;
  ready: boolean;
  /** False when this request came through the public proxy and video stays home. */
  allowed?: boolean;
  job: { state: string; progress: number; error?: string } | null;
  audioTrack: number;
  audios: AudioTrack[];
  subtitles: SubtitleTrack[];
}

/** A profile's audio and subtitles for a work, by language so they carry to the next episode. */
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
  worksFinished: WorkSummary[];
  worksTouched: number;
  daysActive: number;
  longestStreak: number;
  byMonth: { seconds: number; pages: number; finished: number }[];
  byType: Partial<Record<WorkType, number>>;
  top: { workId: string; seconds: number; pages: number; work: WorkSummary }[];
}

const LANGS: Record<string, string> = {
  es: "Español", spa: "Español", "es-419": "Español latino", "es-mx": "Español latino", "es-ar": "Español", "es-es": "Español de España",
  en: "Inglés", eng: "Inglés", ja: "Japonés", jpn: "Japonés", pt: "Portugués", por: "Portugués", fr: "Francés", fra: "Francés", fre: "Francés",
  de: "Alemán", deu: "Alemán", ger: "Alemán", it: "Italiano", ita: "Italiano", ko: "Coreano", kor: "Coreano", zh: "Chino", zho: "Chino",
  chi: "Chino", ru: "Ruso", rus: "Ruso", ca: "Catalán", cat: "Catalán",
};

/** "Japonés · Original", "Inglés · 5.1", "Pista 2": a track as a person reads it. */
export function trackLabel(t: { lang: string | null; title?: string | null; channels?: number | null; label?: string | null }, i: number): string {
  const lang = t.lang ? LANGS[t.lang.toLowerCase()] ?? t.lang.toUpperCase() : null;
  const extra = t.title ?? (t.channels && t.channels > 2 ? (t.channels === 6 ? "5.1" : t.channels === 8 ? "7.1" : `${t.channels} canales`) : null);
  const parts = [lang, extra && extra !== lang ? extra : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : t.label ?? `Pista ${i + 1}`;
}

/** "1 h 44 min", "24 min". */
export function minutes(n: number): string {
  const h = Math.floor(n / 60), m = Math.round(n % 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

export class AuthError extends Error {}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 401) throw new AuthError("token required");
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export const unitPath = (workId: string, key: string) => `/api/v1/units/${workId}/${key}`;

export function saveProgress(workId: string, key: string, position: number, total: number, keepalive = false) {
  return fetch(`/api/v1/progress/${workId}/${key}`, {
    method: "PUT", credentials: "same-origin", keepalive,
    headers: { "content-type": "application/json" }, body: JSON.stringify({ position, total }),
  }).catch(() => undefined);
}

export const TYPE_LABEL: Record<WorkType, string> = {
  film: "Película", series: "Serie", anime: "Anime", manga: "Manga", comic: "Cómic",
};

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(r).padStart(2, "0")}`;
}

/** "Tomo 2 · página 34 de 200", "T1 · E3 · 12:40". */
export function whereLabel(w: { kind: string }, unitLabel: string, p: Progress | null): string {
  if (!p) return unitLabel;
  if (p.finished) return `${unitLabel} · terminado`;
  return w.kind === "video" ? `${unitLabel} · ${clock(p.position)}` : `${unitLabel} · página ${p.position} de ${p.total}`;
}

export function go(hash: string) {
  window.location.hash = hash;
}

export function useQuery(name: string): string | null {
  const q = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(q).get(name);
}

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  hue: number | null;
  glyph: string | null;
  stats?: { inProgress: number; finishedUnits: number; lastAt: string | null };
}

export async function getProfiles(): Promise<{ profiles: Profile[]; current: string }> {
  return api<{ profiles: Profile[]; current: string }>("/api/v1/profiles");
}

export async function useProfile(id: string): Promise<void> {
  await api(`/api/v1/profiles/${encodeURIComponent(id)}/use`, { method: "POST" });
}

export const hasProfileCookie = () => /(?:^|;\s*)archivist_profile=/.test(document.cookie);

export interface Session { created_at: string; last_seen: string; ip: string; agent: string }

export async function logout(): Promise<void> {
  await fetch("/api/v1/logout", { method: "POST", credentials: "same-origin" });
}

/** Whether this browser gets in without a token (a trusted network) — then there is no session to end. */
export async function isOpen(): Promise<boolean> {
  try {
    return Boolean(((await (await fetch("/api/v1/health", { credentials: "same-origin" })).json()) as { open?: boolean }).open);
  } catch {
    return false;
  }
}
