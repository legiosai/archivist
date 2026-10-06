import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { trustedNetworks } from "../src/config.ts";
import { audioOf, playsDirectly, prepareArgs, probe } from "../src/media/video.ts";
import { createApp, type App } from "../src/server.ts";

/** A three-second MKV with two audio tracks (Spanish, Japanese) and English subtitles inside. */
function twoLanguageFilm(dir: string): string {
  const srt = join(dir, "en.srt");
  writeFileSync(srt, "1\n00:00:00,500 --> 00:00:02,000\nHello from inside\n");
  const out = join(dir, "film.mkv");
  execFileSync("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-i", srt,
    "-map", "0", "-map", "1", "-map", "2", "-map", "3", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-c:s", "srt",
    "-metadata:s:a:0", "language=spa", "-metadata:s:a:1", "language=jpn", "-metadata:s:a:1", "title=Original",
    "-metadata:s:s:0", "language=eng", out]);
  return out;
}

let app: App | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe("audio and subtitle tracks", () => {
  it("probes every track, and prepares another audio track as its own copy", async () => {
    const root = mkdtempSync(join(tmpdir(), "archivist-lib-"));
    mkdirSync(join(root, "video"));
    const film = twoLanguageFilm(join(root, "video"));
    const p = await probe(film);
    expect(p.audios!.map((a) => [a.n, a.lang, a.title])).toEqual([[0, "spa", null], [1, "jpn", "Original"]]);
    expect(p.subs!.map((s) => [s.n, s.lang, s.text])).toEqual([[0, "eng", true]]);
    expect(audioOf(p, 1)).toBe(1);
    expect(audioOf(p, 7)).toBe(0);
    expect(playsDirectly("a.mp4", { ...p, container: "mov,mp4" }, 1)).toBe(false);   // the browser would play the first one
    expect(prepareArgs(film, p, "o.mp4", false, 1)).toEqual(expect.arrayContaining(["-map", "0:a:1?", "-c:v", "copy", "-c:a", "copy"]));

    const data = mkdtempSync(join(tmpdir(), "archivist-data-"));
    app = createApp({ library: root, data, host: "127.0.0.1", port: 0, token: null, web: join(data, "no-web"), backup: null,
      trusted: trustedNetworks("") });
    await new Promise<void>((r) => app!.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const unit = `${base}/api/v1/units/video/film/film`;

    const info = await (await fetch(`${unit}/info?audio=1`)).json();
    expect(info.audioTrack).toBe(1);
    expect(info.audios.map((a: { lang: string }) => a.lang)).toEqual(["spa", "jpn"]);
    expect(info.subtitles).toEqual([expect.objectContaining({ index: "e0", lang: "eng", kind: "embedded", href: "/api/v1/units/video/film/film/subtitles/e0" })]);
    expect(info.ready).toBe(false);

    expect((await fetch(`${unit}/prepare?audio=1`, { method: "POST" })).status).toBe(202);
    for (let i = 0; i < 100 && !(await (await fetch(`${unit}/info?audio=1`)).json()).ready; i++) await new Promise((r) => setTimeout(r, 100));
    const video = await fetch(`${unit}/video?audio=1`);
    expect(video.status).toBe(200);
    const copy = join(data, "copy.mp4");
    writeFileSync(copy, Buffer.from(await video.arrayBuffer()));
    const out = await probe(copy);
    expect(out.audios!.length).toBe(1);
    expect(out.audios![0]!.lang).toBe("jpn");
    // The first track is a different copy, not ready yet.
    expect((await fetch(`${unit}/video`)).status).toBe(409);

    const vtt = await (await fetch(`${base}${info.subtitles[0].href}`)).text();
    expect(vtt).toMatch(/^WEBVTT/);
    expect(vtt).toContain("Hello from inside");
    expect((await fetch(`${unit}/subtitles/e3`)).status).toBe(404);
  }, 60_000);

  it("keeps each profile's choice per work", async () => {
    const root = mkdtempSync(join(tmpdir(), "archivist-lib-"));
    mkdirSync(join(root, "video", "dark"), { recursive: true });
    writeFileSync(join(root, "video", "dark", "S01E01.mkv"), "x");
    const data = mkdtempSync(join(tmpdir(), "archivist-data-"));
    app = createApp({ library: root, data, host: "127.0.0.1", port: 0, token: null, web: join(data, "no-web"), backup: null,
      trusted: trustedNetworks("") });
    await new Promise<void>((r) => app!.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    app.store.addProfile("Sol");
    const url = `${base}/api/v1/works/video/dark/tracks`;
    expect(await (await fetch(url)).json()).toEqual({ choice: null });
    await fetch(url, { method: "PUT", body: JSON.stringify({ audio: { lang: "jpn", n: 1 }, subtitle: { lang: "spa", label: null } }) });
    await fetch(`${url}?profile=sol`, { method: "PUT", body: JSON.stringify({ audio: { lang: "spa", n: 0 }, subtitle: "off" }) });
    expect((await (await fetch(url)).json()).choice).toEqual({ audio: { lang: "jpn", n: 1 }, subtitle: { lang: "spa", label: null } });
    expect((await (await fetch(`${url}?profile=sol`)).json()).choice).toEqual({ audio: { lang: "spa", n: 0 }, subtitle: "off" });
  });
});
