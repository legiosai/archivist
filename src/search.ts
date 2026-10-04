/**
 * Finding a work by what someone (or an agent) remembers of it: a few words of the title in any
 * language, with or without accents, the original title, the year, or an id from a database
 * ("anilist 30002"). No index: a library is hundreds of works, not millions.
 */
import type { Work } from "./library/scan.ts";

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** How well `query` names `w`: 0 is no match; an exact title beats a prefix beats loose words. */
export function score(w: Work, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const titles = [w.title, w.originalTitle ?? "", w.slug.replace(/-/g, " ")].map(normalize).filter(Boolean);
  if (titles.includes(q)) return 100;
  if (titles.some((t) => t.startsWith(q))) return 80;
  const hay = [...titles, String(w.year ?? ""), w.type, ...Object.entries(w.ids).flatMap(([k, v]) => [k, String(v)])]
    .join(" ").split(" ").filter(Boolean);
  const words = q.split(" ");
  const hits = words.filter((word) => hay.some((h) => h === word || (word.length >= 3 && h.startsWith(word))));
  if (!hits.length) return titles.some((t) => t.includes(q)) ? 40 : 0;
  // Every word found: a good match, better when the words are short of the title (fewer leftovers).
  if (hits.length === words.length) return 60 + Math.min(15, hits.length * 5);
  return hits.length / words.length >= 0.5 ? Math.round(30 * hits.length / words.length) : 0;
}

export function search(works: Work[], query: string, limit = 20): { work: Work; score: number }[] {
  return works.map((work) => ({ work, score: score(work, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.work.title.localeCompare(b.work.title, "es"))
    .slice(0, limit);
}
