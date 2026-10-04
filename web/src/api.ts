// The UI talks to the same API as any tool; the token travels in an HttpOnly cookie after login.

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
}

export interface VideoInfo {
  duration: number;
  ready: boolean;
  job: { state: string; progress: number; error?: string } | null;
  subtitles: { index: number; label: string; href: string }[];
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
}

export async function getProfiles(): Promise<{ profiles: Profile[]; current: string }> {
  return api<{ profiles: Profile[]; current: string }>("/api/v1/profiles");
}

export async function useProfile(id: string): Promise<void> {
  await api(`/api/v1/profiles/${encodeURIComponent(id)}/use`, { method: "POST" });
}

export const hasProfileCookie = () => /(?:^|;\s*)archivist_profile=/.test(document.cookie);
