import { describe, expect, it } from "vitest";
import { columnOf, samplePages, type Spans } from "../web/src/column.ts";

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

describe("the pages looked at to find the column", () => {
  it("are spread over the book, on both sides of the sheet, and include the one being read", () => {
    const pages = samplePages(548, 175);
    expect(pages).toContain(175);
    expect(pages).toContain(176);
    expect(pages[0]).toBeGreaterThan(20);
    expect(pages.at(-1)).toBeLessThan(530);
    expect(pages.some((p) => p % 2 === 0)).toBe(true);
    expect(pages.some((p) => p % 2 === 1)).toBe(true);
    expect(pages.length).toBeLessThanOrEqual(16);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it("never leave the book", () => {
    expect(samplePages(0, 1)).toEqual([]);
    expect(samplePages(1, 1)).toEqual([1]);
    for (const p of samplePages(5, 5)) { expect(p).toBeGreaterThanOrEqual(1); expect(p).toBeLessThanOrEqual(5); }
  });
});
