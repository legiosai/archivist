import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store, localDay } from "../src/db.ts";

const at = (iso: string) => new Date(iso);

describe("activity and the year", () => {
  it("counts what each save moved forward, not a jump", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "a.db"));
    s.save("video/dark", "s01e01", 20, 3000, "video", at("2026-03-01T20:00:00"));          // a first save counts what came before it
    s.save("video/dark", "s01e01", 620, 3000, "video", at("2026-03-01T20:10:00"));         // ten minutes later, ten minutes in
    s.save("video/dark", "s01e01", 2900, 3000, "video", at("2026-03-01T20:11:00"));        // a jump ahead: not watched
    s.save("pages/berserk", "v01", 1, 200, "pages", at("2026-03-02T10:00:00"));
    s.save("pages/berserk", "v01", 11, 200, "pages", at("2026-03-02T10:05:00"));           // ten pages in five minutes
    s.save("pages/berserk", "v01", 150, 200, "pages", at("2026-03-02T10:06:00"));          // skipping ahead
    const lookup = (id: string) => ({ "video/dark": { type: "series", units: 1 }, "pages/berserk": { type: "manga", units: 2 } })[id];
    const y = s.stats("owner", 2026, lookup);
    expect(y.seconds).toBe(620);
    expect(y.pages).toBe(11);
    expect(y.byMonth[2]).toEqual({ seconds: 620, pages: 11, finished: 1 });
    expect(y.unitsFinished).toBe(1);
    expect(y.worksFinished).toEqual(["video/dark"]);                   // its one episode is done; Berserk has another volume
    expect(y.byType).toEqual({ series: 1, manga: 1 });
    expect(y.daysActive).toBe(2);
    expect(y.longestStreak).toBe(2);
    expect(y.years).toEqual([2026]);
    expect(s.stats("owner", 2025, lookup).seconds).toBe(0);
  });

  it("counts progress from before the log once, on the day it was saved", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "a.db"));
    s.save("video/los-otros", "film", 5000, 6200, "video", at("2026-10-04T22:00:00"));      // a first save far in: not logged
    s.db.exec("DELETE FROM activity");
    s.save("video/los-otros", "film", 5000, 6200, "video", at("2026-10-04T22:00:00"));
    const y = s.stats("owner", 2026, () => ({ type: "film", units: 1 }));
    expect(y.seconds).toBe(5000);
    expect(y.top).toEqual([{ workId: "video/los-otros", seconds: 5000, pages: 0 }]);
    expect(localDay(at("2026-10-04T22:00:00"))).toBe("2026-10-04");
  });
});
