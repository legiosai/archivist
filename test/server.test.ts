import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/server.ts";
import { PNG, makeZip, tempLibrary } from "./helpers.ts";

const TOKEN = "s3cret-token-for-tests";
let app: App | null = null;

async function start(files: Record<string, string | Buffer>, token: string | null = TOKEN) {
  const library = tempLibrary(files);
  const data = mkdtempSync(join(tmpdir(), "archivist-data-"));
  app = createApp({ library, data, host: "127.0.0.1", port: 0, token, web: join(data, "no-web"), backup: null });
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
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toMatch(/^archivist_token=/);
    expect((await fetch(`${base}/api/v1/works`, { headers: { cookie } })).status).toBe(200);
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

  it("serves a placeholder when the UI is not built", async () => {
    const { base } = await start(LIB);
    expect(await (await fetch(`${base}/`)).text()).toContain("UI is not built");
  });
});
