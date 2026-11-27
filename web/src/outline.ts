// Where the reader is in the book's own index. A PDF's outline is a tree of titles, each pointing
// at a place; laid flat in reading order, the place being read falls under one of them. Nothing here
// touches pdf.js: Book.tsx resolves each entry's place and asks these functions the rest.

/** One line of the index. `at` is its place: the page number plus how far down that page (0 to 1); 0 when it points nowhere in the book. */
export interface Entry { title: string; depth: number; at: number }

/** A chapter longer than this is shown by its section instead: on a phone that is the name worth a line. */
const LONG = 60;

/**
 * The entry being read: the one that starts closest before `at`. Among entries that start at the
 * same place (a chapter and its first section), the deeper one, which comes later. -1 before the
 * first entry, or with none.
 */
export function entryAt(entries: Entry[], at: number): number {
  let best = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.at < 1 || e.at > at) continue;
    if (best < 0 || e.at >= entries[best]!.at) best = i;
  }
  return best;
}

/** The entries above `i` in the tree and `i` itself, the top one first. */
export function pathTo(entries: Entry[], i: number): number[] {
  const path: number[] = [];
  let depth = entries[i]?.depth ?? -1;
  for (let k = i; k >= 0 && depth >= 0; k--) {
    if (entries[k]!.depth !== depth) continue;
    path.unshift(k);
    depth--;
  }
  return path;
}

/** How many pages entry `i` runs for: up to the next entry that is not inside it, or the end of the book. */
export function pagesOf(entries: Entry[], i: number, count: number): number {
  const e = entries[i]!;
  let end = count + 1;
  for (let k = i + 1; k < entries.length; k++) {
    const next = entries[k]!;
    if (next.depth <= e.depth && next.at >= 1) { end = Math.floor(next.at); break; }
  }
  return Math.max(0, end - Math.floor(e.at));
}

/**
 * The entry to name where the reader is: the chapter. Books group chapters in parts, and a part
 * says little, so it is the highest entry over `i` that is no longer than a long chapter; when
 * none is, `i` itself.
 */
export function chapterOf(entries: Entry[], i: number, count: number): number {
  if (i < 0) return -1;
  for (const k of pathTo(entries, i)) {
    if (entries[k]!.at >= 1 && pagesOf(entries, k, count) <= LONG) return k;
  }
  return i;
}
