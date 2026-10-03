import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store, isFinished } from "../src/db.ts";
import { openPages } from "../src/media/pages.ts";
import { playsDirectly, prepareArgs, srtToVtt } from "../src/media/video.ts";
import { readZipEntry, readZipIndex } from "../src/media/zip.ts";
import { PNG, makeZip, tempLibrary } from "./helpers.ts";

describe("zip", () => {
  it("lists entries and reads stored and deflated ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    for (const deflate of [true, false]) {
      const file = join(dir, `t-${deflate}.cbz`);
      writeFileSync(file, makeZip([["002.png", PNG], ["001.png", PNG], ["notes.txt", "hola"]], deflate));
      const idx = readZipIndex(file);
      expect(idx.map((e) => e.name)).toEqual(["002.png", "001.png", "notes.txt"]);
      expect(readZipEntry(file, idx[2]!).toString()).toBe("hola");
      expect(readZipEntry(file, idx[0]!).equals(PNG)).toBe(true);
    }
  });

  it("refuses something that is not a zip", () => {
    const file = join(mkdtempSync(join(tmpdir(), "zip-")), "x.cbz");
    writeFileSync(file, "not a zip at all");
    expect(() => readZipIndex(file)).toThrow(/not a zip/);
  });
});

describe("pages", () => {
  it("numbers the images of a CBZ and of a folder in natural order", async () => {
    const root = tempLibrary({
      "pages/a/vol-1.cbz": makeZip([["p10.png", PNG], ["p2.png", PNG], ["__MACOSX/._p2.png", "x"], ["cover.txt", "x"]]),
      "pages/b/vol 1/p10.png": PNG, "pages/b/vol 1/p2.png": PNG, "pages/b/vol 1/.DS_Store": "x",
    });
    const cache = mkdtempSync(join(tmpdir(), "cache-"));
    const cbz = await openPages(root, { key: "v01", label: "Tomo 1", path: "pages/a/vol-1.cbz", format: "cbz" }, cache);
    expect(cbz.count).toBe(2);
    expect((await cbz.page(1)).type).toBe("image/png");
    await expect(cbz.page(3)).rejects.toThrow(RangeError);
    const folder = await openPages(root, { key: "v01", label: "Tomo 1", path: "pages/b/vol 1", format: "images" }, cache);
    expect(folder.count).toBe(2);
  });
});

describe("video", () => {
  it("knows what the browser plays and how to prepare the rest", () => {
    expect(playsDirectly("a.mp4", { container: "mov,mp4", video: "h264", audio: "aac", duration: 1 })).toBe(true);
    expect(playsDirectly("a.mkv", { container: "matroska", video: "h264", audio: "aac", duration: 1 })).toBe(false);
    expect(playsDirectly("a.mp4", { container: "mov,mp4", video: "hevc", audio: "aac", duration: 1 })).toBe(false);
    const remux = prepareArgs("a.mkv", { container: "matroska", video: "h264", audio: "aac", duration: 1 }, "o.mp4", true);
    expect(remux.join(" ")).toContain("-c:v copy");
    expect(remux.join(" ")).toContain("-c:a copy");
    const hevc = prepareArgs("a.mkv", { container: "matroska", video: "hevc", audio: "dts", duration: 1 }, "o.mp4", true);
    expect(hevc.join(" ")).toContain("h264_nvenc");
    expect(hevc.join(" ")).toContain("-c:a aac");
    const cpu = prepareArgs("a.mkv", { container: "matroska", video: "hevc", audio: "aac", duration: 1 }, "o.mp4", false);
    expect(cpu.join(" ")).toContain("libx264");
  });

  it("turns SRT into WebVTT", () => {
    const vtt = srtToVtt("﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nHola\r\n");
    expect(vtt).toBe("WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHola\n");
  });
});

describe("progress", () => {
  it("saves positions, marks finished once and keeps the event log", () => {
    const store = new Store(":memory:");
    expect(isFinished(19, 20, "pages")).toBe(false);
    expect(isFinished(20, 20, "pages")).toBe(true);
    expect(isFinished(950, 1000, "video")).toBe(true);
    const t = (s: number) => new Date(Date.UTC(2026, 9, 3, 12, 0, s));
    expect(store.save("pages/berserk", "v01", 5, 200, "pages", t(1)).newlyFinished).toBe(false);
    expect(store.save("pages/berserk", "v01", 200, 200, "pages", t(2)).newlyFinished).toBe(true);
    expect(store.save("pages/berserk", "v01", 3, 200, "pages", t(3)).progress.finished).toBe(true);  // rereading
    store.save("video/dark", "s01e01", 100, 3000, "video", t(4));
    expect(store.latest().map((p) => p.workId)).toEqual(["video/dark", "pages/berserk"]);
    const ev = store.events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "finished", workId: "pages/berserk", unitKey: "v01" });
    expect(store.events(ev[0]!.id)).toEqual([]);
  });
});

describe("backup", () => {
  it("writes a dated copy and keeps the newest ones", async () => {
    const { mkdtempSync, readdirSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "bk-"));
    const store = new Store(join(dir, "live.db"));
    store.save("pages/a", "v01", 3, 10, "pages");
    for (let d = 1; d <= 5; d++) store.snapshot(join(dir, "out"), 3, new Date(Date.UTC(2026, 9, d)));
    expect(readdirSync(join(dir, "out")).sort()).toEqual(["archivist-2026-10-03.db", "archivist-2026-10-04.db", "archivist-2026-10-05.db"]);
    const copy = new Store(join(dir, "out", "archivist-2026-10-05.db"));
    expect(copy.all()[0]).toMatchObject({ workId: "pages/a", position: 3 });
  });
});
