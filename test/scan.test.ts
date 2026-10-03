import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { episodeOf, naturalCompare, scan, volumeOf } from "../src/library/scan.ts";

function lib(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "archivist-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

describe("scan", () => {
  it("reads a film, a series with subtitles and a manga in volumes", () => {
    const root = lib({
      "video/la-noche.mp4": "x",
      "video/la-noche.yaml": "title: La noche de los muertos vivientes\ntype: film\nyear: 1968\nids: {tmdb_movie: 10331}\n",
      "video/dark/S01E02.mkv": "x",
      "video/dark/S01E01.mkv": "x",
      "video/dark/S01E01.es.srt": "x",
      "video/dark/S02E01.mkv": "x",
      "video/dark/work.yaml": "title: Dark\ntype: series\n",
      "pages/berserk/tomo-10.cbz": "x",
      "pages/berserk/tomo-2.cbz": "x",
      "pages/berserk/work.yaml": "title: Berserk\ntype: manga\nreading: rtl\n",
      "pages/akira/vol 1/001.jpg": "x",
      "pages/akira/vol 2/001.jpg": "x",
      "pages/.hidden/001.jpg": "x",
    });
    const works = Object.fromEntries(scan(root).map((w) => [w.id, w]));
    expect(Object.keys(works).sort()).toEqual(["pages/akira", "pages/berserk", "video/dark", "video/la-noche"]);

    const film = works["video/la-noche"]!;
    expect(film.type).toBe("film");
    expect(film.ids).toEqual({ tmdb_movie: 10331 });
    expect(film.units).toHaveLength(1);

    const dark = works["video/dark"]!;
    expect(dark.units.map((u) => u.key)).toEqual(["s01e01", "s01e02", "s02e01"]);
    expect(dark.units[0]!.subtitles).toEqual(["video/dark/S01E01.es.srt"]);

    const berserk = works["pages/berserk"]!;
    expect(berserk.reading).toBe("rtl");
    expect(berserk.units.map((u) => [u.volume, u.format])).toEqual([[2, "cbz"], [10, "cbz"]]);

    const akira = works["pages/akira"]!;
    expect(akira.type).toBe("comic");           // no yaml: left-to-right comic by default
    expect(akira.title).toBe("Akira");
    expect(akira.units.map((u) => u.label)).toEqual(["Tomo 1", "Tomo 2"]);
  });

  it("treats a missing root as an error", () => {
    expect(() => scan("/nonexistent/archivist")).toThrow();
  });
});

describe("names", () => {
  it("finds seasons, episodes and volumes", () => {
    expect(episodeOf("Dark.S02E07.1080p.mkv")).toEqual({ season: 2, episode: 7 });
    expect(episodeOf("dark 1x03.mkv")).toEqual({ season: 1, episode: 3 });
    expect(episodeOf("pilot.mkv", { season: 1, episode: 1 })).toEqual({ season: 1, episode: 1 });
    expect(volumeOf("Berserk v03 (2003)")).toBe(3);
    expect(volumeOf("Tomo 12")).toBe(12);
    expect(volumeOf("extra")).toBeUndefined();
    expect(["p10", "p2", "p1"].sort(naturalCompare)).toEqual(["p1", "p2", "p10"]);
  });
});

describe("library", async () => {
  const { Library, safeSegment, slugify } = await import("../src/library/index.ts");

  it("creates works as folders plus yaml, and lists them before their first file", () => {
    const root = lib({ "video/.keep": "" });
    const library = new Library(root);
    library.rescan();
    const film = library.create({ title: "La noche de los muertos vivientes", type: "film", year: 1968 });
    expect(film.id).toBe("video/la-noche-de-los-muertos-vivientes");
    expect(film.units).toEqual([]);
    const manga = library.create({ title: "Akira", type: "manga" });
    expect(manga.reading).toBe("rtl");
    const dark = library.create({ title: "Dark", type: "series" });
    expect(library.list().map((w) => w.id).sort()).toEqual([dark.id, manga.id, film.id].sort());
  });

  it("decides where an upload goes and refuses the rest", () => {
    const root = lib({ "video/.keep": "" });
    const library = new Library(root);
    library.rescan();
    const film = library.create({ title: "Nosferatu", type: "film" });
    const series = library.create({ title: "Dark", type: "series" });
    const manga = library.create({ title: "Akira", type: "manga" });
    expect(library.target(film, "whatever.mkv")).toBe("video/nosferatu.mkv");
    expect(library.target(film, "Nosferatu.es.srt")).toBe("video/nosferatu.es.srt");
    expect(library.target(series, "Dark.S01E01.mkv")).toBe("video/dark/Dark.S01E01.mkv");
    expect(library.target(manga, "Vol 2/003.jpg")).toBe("pages/akira/Vol 2/003.jpg");
    expect(library.target(manga, "Akira v01.cbz")).toBe("pages/akira/Akira v01.cbz");
    expect(() => library.target(manga, "run.sh")).toThrow();
    expect(() => library.target(series, "../x.mkv")).toThrow();
    expect(() => library.resolve("../../etc/passwd")).toThrow(/outside/);
    expect(slugify("Ñandú: el regreso!")).toBe("nandu-el-regreso");
    expect(() => safeSegment("..")).toThrow();
  });
});
