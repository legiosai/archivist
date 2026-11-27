// Where the words sit across a book's pages. A PDF page keeps the margins of the printed sheet, and
// on a phone they take a third of the width; knowing the column lets the viewer zoom to the words
// and leave the margins off screen. Nothing here touches pdf.js: pdf.ts reads the pages.

/** Text runs of one page, each as [left, right] in fractions of the page's width. */
export type Spans = [number, number][];

const BINS = 200;
/** A page with fewer runs than this is a cover, a blank or a figure: it says nothing about the column. */
const MIN_RUNS = 8;
/** Room left on each side of the words, as a fraction of the page's width. */
const GUTTER = 0.015;

/**
 * The pages to look at: spread over the whole book (its first and last pages are covers, contents
 * and indexes, laid out differently), left and right pages alternating, plus the one being read.
 */
export function samplePages(count: number, near: number, k = 14): number[] {
  if (count < 1) return [];
  const lo = Math.max(1, Math.round(count * 0.06)), hi = Math.max(lo, Math.round(count * 0.94));
  const picked = new Set<number>();
  for (let i = 0; i < k; i++) {
    let p = Math.round(lo + ((hi - lo) * i) / Math.max(1, k - 1));
    if ((p + i) % 2 && p < hi) p++;
    picked.add(Math.min(count, Math.max(1, p)));
  }
  for (const p of [near, near + 1]) if (p >= 1 && p <= count) picked.add(p);
  return [...picked].sort((a, b) => a - b);
}

/**
 * The column, as [left, right] in fractions of the page's width: every part of the width that has
 * words on at least `share` of the pages. So a heading or a label that hangs in the margin of most
 * pages stays inside, and one wide table on one page does not widen it for the whole book. `null`
 * when too few pages have text to tell (a scanned book).
 */
export function columnOf(pages: Spans[], share = 0.3): [number, number] | null {
  const texty = pages.filter((p) => p.length >= MIN_RUNS);
  if (texty.length < 3) return null;
  const cover = new Array<number>(BINS).fill(0);
  for (const spans of texty) {
    const seen = new Uint8Array(BINS);
    for (const [a, b] of spans) {
      if (!(b > a)) continue;
      const from = Math.max(0, Math.floor(a * BINS)), to = Math.min(BINS - 1, Math.ceil(b * BINS) - 1);
      for (let i = from; i <= to; i++) seen[i] = 1;
    }
    for (let i = 0; i < BINS; i++) cover[i]! += seen[i]!;
  }
  const need = Math.max(2, Math.ceil(texty.length * share));
  let left = -1, right = -1;
  for (let i = 0; i < BINS; i++) {
    if (cover[i]! < need) continue;
    if (left < 0) left = i;
    right = i;
  }
  if (left < 0) return null;
  return [Math.max(0, left / BINS - GUTTER), Math.min(1, (right + 1) / BINS + GUTTER)];
}
