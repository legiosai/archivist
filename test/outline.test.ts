import { describe, expect, it } from "vitest";
import { chapterOf, entryAt, pagesOf, pathTo, type Entry } from "../web/src/outline.ts";

const e = (title: string, depth: number, at: number): Entry => ({ title, depth, at });

// A book in parts: 400 pages.
const PARTS: Entry[] = [
  e("Cover", 0, 1),
  e("Part 1: Learning the Shell", 0, 21),
  e("1. What Is the Shell?", 1, 23),
  e("Terminal Emulators", 2, 23.3),
  e("Your First Keystrokes", 2, 24.1),
  e("2. Navigation", 1, 29),
  e("The File System Tree", 2, 29.2),
  e("3. Exploring the System", 1, 41),
  e("Part 2: Configuration", 0, 150),
  e("11. The Environment", 1, 152),
  e("A link to the publisher", 1, 0),
  e("Index", 0, 380),
];

describe("the place in a book's index", () => {
  it("is the entry that starts closest before what is being read", () => {
    expect(entryAt(PARTS, 23.5)).toBe(3);
    expect(entryAt(PARTS, 24.05)).toBe(3);    // the next heading is still below the middle of the screen
    expect(entryAt(PARTS, 24.2)).toBe(4);
    expect(entryAt(PARTS, 28.9)).toBe(4);
    expect(entryAt(PARTS, 200)).toBe(9);
    expect(entryAt(PARTS, 399)).toBe(11);
  });

  it("is the deeper of two entries that start at the same place, and none before the first", () => {
    const same = [e("Chapter 3", 0, 57), e("3.1 Values", 1, 57), e("3.2 Types", 1, 57.6)];
    expect(entryAt(same, 57.2)).toBe(1);
    expect(entryAt(same, 56.9)).toBe(-1);
    expect(entryAt([], 3)).toBe(-1);
    expect(entryAt([e("Nowhere", 0, 0)], 3)).toBe(-1);
  });

  it("knows what an entry is inside of, and how long it runs", () => {
    expect(pathTo(PARTS, 4)).toEqual([1, 2, 4]);
    expect(pathTo(PARTS, 0)).toEqual([0]);
    expect(pathTo(PARTS, 9)).toEqual([8, 9]);
    expect(pathTo(PARTS, 11)).toEqual([11]);
    expect(pagesOf(PARTS, 1, 400)).toBe(129);   // the part, up to the next part
    expect(pagesOf(PARTS, 2, 400)).toBe(6);     // the chapter, up to the next chapter
    expect(pagesOf(PARTS, 9, 400)).toBe(228);   // the entry that points nowhere does not end it
    expect(pagesOf(PARTS, 11, 400)).toBe(21);   // the last one, up to the end of the book
  });
});

describe("the chapter named over the page", () => {
  it("is the chapter, not the part it belongs to nor the section inside it", () => {
    expect(PARTS[chapterOf(PARTS, 4, 400)]!.title).toBe("1. What Is the Shell?");
    expect(PARTS[chapterOf(PARTS, 6, 400)]!.title).toBe("2. Navigation");
    expect(PARTS[chapterOf(PARTS, 0, 400)]!.title).toBe("Cover");
  });

  it("is the part on the part's own page, and the section in a chapter too long to say much", () => {
    expect(PARTS[chapterOf(PARTS, 1, 400)]!.title).toBe("Part 1: Learning the Shell");
    expect(PARTS[chapterOf(PARTS, 9, 400)]!.title).toBe("11. The Environment");
    const long = [e("Reference", 0, 10), e("Commands A to F", 1, 12), e("Commands G to Z", 1, 80)];
    expect(long[chapterOf(long, 1, 300)]!.title).toBe("Commands A to F");
    expect(chapterOf(long, -1, 300)).toBe(-1);
  });
});
