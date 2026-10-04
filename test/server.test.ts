import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isTrusted, trustedNetworks } from "../src/config.ts";
import { createApp, type App } from "../src/server.ts";
import { PNG, makeZip, tempLibrary } from "./helpers.ts";

const TOKEN = "s3cret-token-for-tests";
let app: App | null = null;

async function start(files: Record<string, string | Buffer>, token: string | null = TOKEN, trusted = "") {
  const library = tempLibrary(files);
  const data = mkdtempSync(join(tmpdir(), "archivist-data-"));
  app = createApp({ library, data, host: "127.0.0.1", port: 0, token, web: join(data, "no-web"), backup: null,
    trusted: trustedNetworks(trusted) });
  await new Promise<void>((r) => app!.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const api = (path: string, init: RequestInit = {}) => fetch(base + path, {
    ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { base, api, library };
}

afterEach(async () => {
  await app?.close();
  app = null;
});

const LIB = {
  "pages/berserk/tomo-01.cbz": makeZip([["001.png", PNG], ["002.png", PNG], ["003.png", PNG]]),
  "pages/berserk/work.yaml": "title: Berserk\ntype: manga\nreading: rtl\nids: {anilist: 30002}\n",
};

describe("server", () => {
  it("asks for the token, by header or by the login cookie", async () => {
    const { base } = await start(LIB);
    expect((await fetch(`${base}/api/v1/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/works`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/login`, { method: "POST", body: JSON.stringify({ token: "nope" }) })).status).toBe(401);
    const login = await fetch(`${base}/api/v1/login`, { method: "POST", body: JSON.stringify({ token: TOKEN }) });
    const setCookie = login.headers.get("set-cookie")!;
    const cookie = setCookie.split(";")[0]!;
    expect(cookie).toMatch(/^archivist_session=/);
    expect(setCookie).not.toContain(TOKEN);                    // the cookie is a session, never the token
    expect(setCookie).not.toContain("Secure");                 // plain http on the LAN
    expect((await fetch(`${base}/api/v1/works`, { headers: { cookie } })).status).toBe(200);
    await fetch(`${base}/api/v1/logout`, { method: "POST", headers: { cookie } });
    expect((await fetch(`${base}/api/v1/works`, { headers: { cookie } })).status).toBe(401);
  });

  it("never trusts what came through the tunnel, even from loopback", async () => {
    const { base } = await start({ ...LIB, "video/clip.mp4": "not really a video" }, TOKEN, "loopback");
    const tunnel = { "cf-connecting-ip": "198.51.100.7", "x-forwarded-proto": "https" };
    expect((await fetch(`${base}/api/v1/works`)).status).toBe(200);                       // the LAN, or a local tool
    expect((await fetch(`${base}/api/v1/works`, { headers: tunnel })).status).toBe(401);  // the internet
    expect(await (await fetch(`${base}/api/v1/health`, { headers: tunnel })).json()).toMatchObject({ open: false });

    const login = await fetch(`${base}/api/v1/login`, { method: "POST", headers: tunnel, body: JSON.stringify({ token: TOKEN }) });
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toContain("Secure");
    const cookie = setCookie.split(";")[0]!;
    expect((await fetch(`${base}/api/v1/works`, { headers: { ...tunnel, cookie } })).status).toBe(200);
    // Video stays at home unless ARCHIVIST_PROXIED_VIDEO says otherwise.
    const video = await fetch(`${base}/api/v1/units/video/clip/film/video`, { headers: { ...tunnel, cookie } });
    expect(video.status).toBe(403);

    const sessions = await (await fetch(`${base}/api/v1/sessions`, { headers: { ...tunnel, cookie } })).json();
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0].ip).toBe("198.51.100.7");
    await fetch(`${base}/api/v1/sessions`, { method: "DELETE", headers: { ...tunnel, cookie } });
    expect((await fetch(`${base}/api/v1/works`, { headers: { ...tunnel, cookie } })).status).toBe(401);
  });

  it("locks a client out after too many wrong tokens, by its real address", async () => {
    const { base } = await start(LIB);
    const from = (ip: string) => ({ "cf-connecting-ip": ip });
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/api/v1/login`, { method: "POST", headers: from("198.51.100.8"), body: JSON.stringify({ token: "nope" }) });
      expect(r.status).toBe(401);
    }
    const right = await fetch(`${base}/api/v1/login`, { method: "POST", headers: from("198.51.100.8"), body: JSON.stringify({ token: TOKEN }) });
    expect(right.status).toBe(429);                            // even the right token, until the window ends
    expect(right.headers.get("retry-after")).toBe("900");
    expect((await fetch(`${base}/api/v1/works`, { headers: { ...from("198.51.100.9"), authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    for (let i = 0; i < 10; i++) await fetch(`${base}/api/v1/works`, { headers: { ...from("198.51.100.10"), authorization: "Bearer nope" } });
    expect((await fetch(`${base}/api/v1/works`, { headers: from("198.51.100.10") })).status).toBe(429);
  });

  it("sends the hardening headers, and HSTS only over https", async () => {
    const { base } = await start(LIB);
    const plain = await fetch(`${base}/api/v1/health`);
    expect(plain.headers.get("x-content-type-options")).toBe("nosniff");
    expect(plain.headers.get("x-frame-options")).toBe("DENY");
    expect(plain.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(plain.headers.get("strict-transport-security")).toBeNull();
    const tls = await fetch(`${base}/api/v1/health`, { headers: { "cf-connecting-ip": "198.51.100.7", "cf-visitor": '{"scheme":"https"}' } });
    expect(tls.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("lists works, serves pages and keeps progress", async () => {
    const { api } = await start(LIB);
    const { works } = await (await api("/api/v1/works")).json() as { works: { id: string; units: number }[] };
    expect(works).toMatchObject([{ id: "pages/berserk", units: 1 }]);
    const work = await (await api("/api/v1/works/pages/berserk")).json() as { unitList: { key: string }[]; reading: string };
    expect(work.reading).toBe("rtl");
    expect(work.unitList[0]!.key).toBe("v01");
    expect(await (await api("/api/v1/units/pages/berserk/v01/pages")).json()).toEqual({ count: 3 });
    const page = await api("/api/v1/units/pages/berserk/v01/pages/2");
    expect(page.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await page.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await api("/api/v1/units/pages/berserk/v01/pages/9")).status).toBe(404);
    expect((await api("/api/v1/units/pages/berserk/v99/pages")).status).toBe(404);

    const saved = await api("/api/v1/progress/pages/berserk/v01", { method: "PUT", body: JSON.stringify({ position: 3, total: 3 }) });
    expect(await saved.json()).toMatchObject({ newlyFinished: true, progress: { finished: true } });
    const progress = await (await api("/api/v1/progress")).json() as { latest: { workId: string; work: { finished: number } }[] };
    expect(progress.latest[0]).toMatchObject({ workId: "pages/berserk", work: { finished: 1 } });
    const ev = await (await api("/api/v1/events?since=0")).json() as { events: { type: string }[] };
    expect(ev.events.map((e) => e.type)).toEqual(["finished"]);
  });

  it("creates a work and receives a resumable upload into it", async () => {
    const { api, library } = await start(LIB);
    const created = await api("/api/v1/works", { method: "POST", body: JSON.stringify({ title: "Akira", type: "manga", year: 1982 }) });
    expect(created.status).toBe(201);
    expect(readFileSync(join(library, "pages/akira/work.yaml"), "utf8")).toContain("reading: rtl");
    const cbz = makeZip([["001.png", PNG], ["002.png", PNG]]);
    const up = await (await api("/api/v1/uploads", { method: "POST",
      body: JSON.stringify({ workId: "pages/akira", path: "Akira v01.cbz", size: cbz.length }) })).json() as { id: string; target: string };
    expect(up.target).toBe("pages/akira/Akira v01.cbz");
    const half = Math.floor(cbz.length / 2);
    let r = await api(`/api/v1/uploads/${up.id}`, { method: "PATCH", headers: { "upload-offset": "0",
      "content-type": "application/offset+octet-stream" }, body: new Uint8Array(cbz.subarray(0, half)) });
    expect(r.status).toBe(204);
    expect((await api(`/api/v1/uploads/${up.id}`, { method: "HEAD" })).headers.get("upload-offset")).toBe(String(half));
    r = await api(`/api/v1/uploads/${up.id}`, { method: "PATCH", headers: { "upload-offset": "0" }, body: new Uint8Array(cbz.subarray(half)) });
    expect(r.status).toBe(409);                                         // wrong offset: resume from the server's
    r = await api(`/api/v1/uploads/${up.id}`, { method: "PATCH", headers: { "upload-offset": String(half) }, body: new Uint8Array(cbz.subarray(half)) });
    expect(r.headers.get("upload-done")).toBe("true");
    expect(existsSync(join(library, "pages/akira/Akira v01.cbz"))).toBe(true);
    const akira = await (await api("/api/v1/works/pages/akira")).json() as { units: number };
    expect(akira.units).toBe(1);
  });

  it("refuses paths outside the library and files a work cannot hold", async () => {
    const { api } = await start(LIB);
    const bad = await api("/api/v1/uploads", { method: "POST", body: JSON.stringify({ workId: "pages/berserk", path: "../../etc/passwd.cbz", size: 10 }) });
    expect(bad.status).toBe(400);                                         // ".." is never a path segment
    const exe = await api("/api/v1/uploads", { method: "POST", body: JSON.stringify({ workId: "pages/berserk", path: "run.sh", size: 10 }) });
    expect(exe.status).toBe(400);
    const cross = await api("/api/v1/rescan", { method: "POST", headers: { origin: "http://evil.example" } });
    expect(cross.status).toBe(403);
  });

  it("lets trusted networks in without the token, and only by the socket address", async () => {
    const { base } = await start(LIB, TOKEN, "loopback");
    expect((await fetch(`${base}/api/v1/works`)).status).toBe(200);
    expect(await (await fetch(`${base}/api/v1/health`)).json()).toMatchObject({ open: true });
    const t = trustedNetworks("tailscale,lan,203.0.113.0/24");
    expect(isTrusted(t, "100.66.32.75")).toBe(true);
    expect(isTrusted(t, "::ffff:192.168.1.20")).toBe(true);
    expect(isTrusted(t, "fd7a:115c:a1e0::1")).toBe(true);
    expect(isTrusted(t, "203.0.113.9")).toBe(true);
    expect(isTrusted(t, "8.8.8.8")).toBe(false);
    expect(isTrusted(t, "127.0.0.1")).toBe(false);            // loopback only when asked for
    expect(() => trustedNetworks("nope")).toThrow(/not a network/);
  });

  it("serves OPDS catalogs to readers, with Basic auth and PSE that saves the page", async () => {
    const { base } = await start(LIB);
    const basic = { authorization: `Basic ${Buffer.from(`any:${TOKEN}`).toString("base64")}` };
    const anon = await fetch(`${base}/opds`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toContain("Basic");
    const root = await fetch(`${base}/opds`, { headers: basic });
    expect(root.headers.get("content-type")).toContain("application/atom+xml");
    const rootXml = await root.text();
    expect(rootXml).toContain('href="/opds/type/manga"');
    expect(rootXml).toContain("Seguir leyendo");
    const work = await (await fetch(`${base}/opds/w/pages/berserk`, { headers: basic })).text();
    expect(work).toContain('pse:count="3"');
    expect(work).toContain('href="/opds/pse/pages/berserk/v01/{pageNumber}"');
    expect(work).toContain('href="/api/v1/units/pages/berserk/v01/file"');
    const page = await fetch(`${base}/opds/pse/pages/berserk/v01/1`, { headers: basic });   // 0-based: page 2
    expect(Buffer.from(await page.arrayBuffer()).equals(PNG)).toBe(true);
    const progress = await (await fetch(`${base}/api/v1/progress`, { headers: basic })).json() as { all: { position: number }[] };
    expect(progress.all[0]!.position).toBe(2);
    expect(await (await fetch(`${base}/opds/w/pages/berserk`, { headers: basic })).text()).toContain('pse:lastRead="1"');
    const file = await fetch(`${base}/api/v1/units/pages/berserk/v01/file`, { headers: basic });
    expect(file.headers.get("content-type")).toBe("application/vnd.comicbook+zip");
    expect((await fetch(`${base}/opds/continue`, { headers: basic })).status).toBe(200);
  });

  it("keeps a separate place for each profile: header, cookie and OPDS user name", async () => {
    const { base, api } = await start(LIB);
    expect((await (await api("/api/v1/profiles", { method: "POST", body: JSON.stringify({ name: "Sol" }) })).json() as { id: string }).id).toBe("sol");
    await api("/api/v1/progress/pages/berserk/v01", { method: "PUT", body: JSON.stringify({ position: 2, total: 3 }) });
    await api("/api/v1/progress/pages/berserk/v01", { method: "PUT", headers: { "x-archivist-profile": "sol" },
      body: JSON.stringify({ position: 1, total: 3 }) });
    const mine = await (await api("/api/v1/progress")).json() as { profile: string; all: { position: number }[] };
    expect(mine).toMatchObject({ profile: "owner", all: [{ position: 2 }] });
    const use = await api("/api/v1/profiles/sol/use", { method: "POST" });
    const cookie = use.headers.get("set-cookie")!.split(";")[0]!;
    const hers = await (await api("/api/v1/progress", { headers: { cookie } })).json() as { profile: string; all: { position: number }[] };
    expect(hers).toMatchObject({ profile: "sol", all: [{ position: 1 }] });
    const basicSol = { authorization: `Basic ${Buffer.from(`sol:${TOKEN}`).toString("base64")}` };
    expect(await (await fetch(`${base}/opds/w/pages/berserk`, { headers: basicSol })).text()).toContain('pse:lastRead="0"');
    const perProfile = await (await fetch(`${base}/opds/w/pages/berserk?profile=sol`, { headers: basicSol })).text();
    expect(perProfile).toContain('/opds/pse/pages/berserk/v01/{pageNumber}?profile=sol');
    expect(await (await fetch(`${base}/opds?profile=sol`, { headers: basicSol })).text()).toContain('href="/opds/all?profile=sol"');
    await fetch(`${base}/opds/pse/pages/berserk/v01/2?profile=sol`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect((await (await api("/api/v1/progress?profile=sol")).json() as { all: { position: number }[] }).all[0]!.position).toBe(3);
    expect((await api("/api/v1/profiles/owner", { method: "DELETE" })).status).toBe(400);
    expect((await api("/api/v1/profiles/sol", { method: "DELETE" })).status).toBe(200);
  });

  it("lets each profile pick an avatar, and counts what it has read", async () => {
    const { api } = await start(LIB);
    const sol = await (await api("/api/v1/profiles", { method: "POST", body: JSON.stringify({ name: "Sol", hue: 200, glyph: "🦊" }) })).json();
    expect(sol).toMatchObject({ id: "sol", hue: 200, glyph: "🦊" });
    expect((await api("/api/v1/profiles/sol", { method: "PATCH", body: JSON.stringify({ glyph: "🐉" }) })).status).toBe(200);
    for (const bad of [{ hue: 400 }, { hue: 1.5 }, { glyph: "ab" }, { glyph: "<b>" }, { glyph: "🦊🐉" }]) {
      expect((await api("/api/v1/profiles/sol", { method: "PATCH", body: JSON.stringify(bad) })).status).toBe(400);
    }
    await api("/api/v1/progress/pages/berserk/v01", { method: "PUT", headers: { "x-archivist-profile": "sol" }, body: JSON.stringify({ position: 1, total: 3 }) });
    const { profiles } = await (await api("/api/v1/profiles")).json();
    const got = profiles.find((p: { id: string }) => p.id === "sol");
    expect(got).toMatchObject({ name: "Sol", hue: 200, glyph: "🐉", stats: { inProgress: 1, finishedUnits: 0 } });
    expect(got.stats.lastAt).toBeTruthy();
    expect(profiles.find((p: { id: string }) => p.id === "owner").stats).toEqual({ inProgress: 0, finishedUnits: 0, lastAt: null });
    expect((await api("/api/v1/profiles/sol", { method: "PATCH", body: JSON.stringify({ hue: null, glyph: null }) })).status).toBe(200);
  });

  it("serves a placeholder when the UI is not built", async () => {
    const { base } = await start(LIB);
    expect(await (await fetch(`${base}/`)).text()).toContain("UI is not built");
  });
});
