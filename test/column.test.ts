import { describe, expect, it } from "vitest";
import { columnOf, fitOf, samplePages, type Spans } from "../web/src/column.ts";

/** A page of body text: `lines` runs from `left` to `right`, as fractions of the page's width. */
const body = (left: number, right: number, lines = 30): Spans => Array.from({ length: lines }, () => [left, right] as [number, number]);

describe("the column of a book's words", () => {
  it("is where the text of most pages sits, with a little room on each side", () => {
    const col = columnOf(Array.from({ length: 10 }, () => body(0.2, 0.8)));
    expect(col).not.toBeNull();
    expect(col![0]).toBeCloseTo(0.185, 2);
    expect(col![1]).toBeCloseTo(0.815, 2);
  });

  it("keeps what hangs in the margin on many pages, and ignores what does on one", () => {
    const pages = Array.from({ length: 10 }, (_, i) => {
      const page = body(0.25, 0.9);
      if (i % 2 === 0) page.push([0.13, 0.24]);   // a heading that starts in the margin, every other page
      if (i === 3) page.push([0.02, 0.98]);       // one wide table
      return page;
    });
    const col = columnOf(pages)!;
    expect(col[0]).toBeCloseTo(0.115, 2);
    expect(col[1]).toBeCloseTo(0.915, 2);
  });

  it("covers both sides of a book whose left and right pages are set apart", () => {
    const pages = Array.from({ length: 12 }, (_, i) => (i % 2 ? body(0.12, 0.78) : body(0.22, 0.88)));
    const col = columnOf(pages)!;
    expect(col[0]).toBeCloseTo(0.105, 2);
    expect(col[1]).toBeCloseTo(0.895, 2);
  });

  it("does not count covers, blanks and figures", () => {
    const pages = [...Array.from({ length: 5 }, () => body(0.2, 0.8)), [[0.01, 0.99]] as Spans, [] as Spans];
    const col = columnOf(pages)!;
    expect(col[0]).toBeCloseTo(0.185, 2);
    expect(col[1]).toBeCloseTo(0.815, 2);
  });

  it("says nothing of a book without text", () => {
    expect(columnOf([])).toBeNull();
    expect(columnOf([[], [], [], []])).toBeNull();
    expect(columnOf([body(0.2, 0.8), body(0.2, 0.8)])).toBeNull();
  });

  it("stays inside the page", () => {
    expect(columnOf(Array.from({ length: 4 }, () => body(-0.2, 1.3)))).toEqual([0, 1]);
  });
});

describe("the fit of a book printed on both sides of the sheet", () => {
  /** Pages 1 to `count`: odd ones with the words from `odd`, even ones from `even`. */
  const book = (odd: [number, number], even: [number, number], count = 16) =>
    Array.from({ length: count }, (_, i) => ({ n: i + 1, spans: i % 2 === 0 ? body(...odd) : body(...even) }));

  it("is as wide as one page's column, and moves each side to it", () => {
    const fit = fitOf(book([0.22, 0.88], [0.12, 0.78]))!;
    // One column over both sides would run from 0.105 to 0.895; each side's own is 0.69 wide.
    expect(fit.col[1] - fit.col[0]).toBeCloseTo(0.69, 2);
    expect((fit.col[0] + fit.col[1]) / 2).toBeCloseTo(0.5, 2);
    expect(fit.shift[0]).toBeCloseTo(-0.05, 2);   // odd pages hold the words to the right: they move left
    expect(fit.shift[1]).toBeCloseTo(0.05, 2);
    // Moved, each side's words fill the column exactly.
    expect(0.22 - 0.015 + fit.shift[0]).toBeCloseTo(fit.col[0], 2);
    expect(0.12 - 0.015 + fit.shift[1]).toBeCloseTo(fit.col[0], 2);
  });

  it("takes the wider side's width when the two differ", () => {
    const fit = fitOf(book([0.2, 0.9], [0.1, 0.7]))!;
    expect(fit.col[1] - fit.col[0]).toBeCloseTo(0.73, 2);
    expect(0.2 - 0.015 + fit.shift[0]).toBeCloseTo(fit.col[0], 2);
  });

  it("leaves a book with the same margins on every page as it is", () => {
    expect(fitOf(book([0.2, 0.8], [0.2, 0.8]))).toEqual({ col: columnOf(Array.from({ length: 16 }, () => body(0.2, 0.8))), shift: [0, 0] });
    expect(fitOf(book([0.2, 0.8], [0.203, 0.803]))!.shift).toEqual([0, 0]);   // a hair apart is nothing to move for
  });

  it("falls back to one column when one side has too little text to tell", () => {
    const pages = book([0.22, 0.88], [0.12, 0.78]).map((p) => (p.n % 2 ? p : { n: p.n, spans: [] as Spans }));
    const fit = fitOf(pages)!;
    expect(fit.shift).toEqual([0, 0]);
    expect(fit.col[0]).toBeCloseTo(0.205, 2);
    expect(fitOf([])).toBeNull();
  });
});

describe("the pages looked at to find the column", () => {
  it("are spread over the book, on both sides of the sheet, and include the one being read", () => {
    const pages = samplePages(548, 175);
    expect(pages).toContain(175);
    expect(pages).toContain(176);
    expect(pages[0]).toBeGreaterThan(20);
    expect(pages.at(-1)).toBeLessThan(530);
    expect(pages.some((p) => p % 2 === 0)).toBe(true);
    expect(pages.some((p) => p % 2 === 1)).toBe(true);
    expect(pages.length).toBeLessThanOrEqual(22);
    expect(pages.filter((p) => p % 2 === 0).length).toBeGreaterThanOrEqual(6);
    expect(pages.filter((p) => p % 2 === 1).length).toBeGreaterThanOrEqual(6);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it("never leave the book", () => {
    expect(samplePages(0, 1)).toEqual([]);
    expect(samplePages(1, 1)).toEqual([1]);
    for (const p of samplePages(5, 5)) { expect(p).toBeGreaterThanOrEqual(1); expect(p).toBeLessThanOrEqual(5); }
  });
});
