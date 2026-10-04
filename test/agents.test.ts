import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { trustedNetworks } from "../src/config.ts";
import { clientOf, localHost } from "../src/security.ts";
import type { Work } from "../src/library/scan.ts";
import { toolNames } from "../src/mcp.ts";
import { openapi } from "../src/openapi.ts";
import { score, search } from "../src/search.ts";
import { createApp, type App } from "../src/server.ts";
import { PNG, makeZip, tempLibrary } from "./helpers.ts";

const TOKEN = "s3cret-token-for-tests";
let app: App | null = null;

async function start(trusted = "") {
  const library = tempLibrary({
    "pages/berserk/tomo-01.cbz": makeZip([["001.png", PNG], ["002.png", PNG]]),
    "pages/berserk/work.yaml": "title: Berserk\ntype: manga\nids: {anilist: 30002}\n",
    "pages/pokemon-adventures/tomo-01.cbz": makeZip([["001.png", PNG]]),
    "pages/pokemon-adventures/work.yaml": "title: Pokémon Adventures\noriginal_title: ポケットモンスタースペシャル\ntype: manga\nyear: 1997\n",
  });
  const data = mkdtempSync(join(tmpdir(), "archivist-data-"));
  app = createApp({ library, data, host: "127.0.0.1", port: 0, token: TOKEN, web: join(data, "no-web"), backup: null,
    trusted: trustedNetworks(trusted) });
  await new Promise<void>((r) => app!.server.listen(0, "127.0.0.1", r));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  let id = 0;
  const rpc = async (method: string, params: unknown = {}, auth = true) => {
    const r = await fetch(`${base}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
        ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) } });
    return { status: r.status, headers: r.headers, body: r.status === 200 ? await r.json() : null };
  };
  const call = async (name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args })).body.result;
  return { base, port, rpc, call };
}

afterEach(async () => {
  await app?.close();
  app = null;
});

const work = (title: string, extra: Partial<Work> = {}): Work => ({ id: `pages/${title}`, slug: title.toLowerCase().replace(/\W+/g, "-"),
  kind: "pages", type: "manga", title, ids: {}, reading: "rtl", path: "", units: [], ...extra });

describe("search", () => {
  it("finds a work by what someone remembers of it", () => {
    const works = [work("Berserk", { ids: { anilist: 30002 } }), work("Pokémon Adventures", { year: 1997 }), work("Monster")];
    expect(score(works[0]!, "berserk")).toBe(100);
    expect(search(works, "pokemon")[0]!.work.title).toBe("Pokémon Adventures");     // no accent needed
    expect(search(works, "adventures pokemon")[0]!.work.title).toBe("Pokémon Adventures");
    expect(search(works, "30002")[0]!.work.title).toBe("Berserk");                  // an id
    expect(search(works, "1997")[0]!.work.title).toBe("Pokémon Adventures");
    expect(search(works, "mons")[0]!.work.title).toBe("Monster");                   // a prefix
    expect(search(works, "zzz")).toEqual([]);
    expect(search(works, "")).toEqual([]);
  });
});

describe("for agents", () => {
  it("searches over the API", async () => {
    const { base } = await start();
    const r = await (await fetch(`${base}/api/v1/search?q=pokemon`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(r.results[0]).toMatchObject({ id: "pages/pokemon-adventures", title: "Pokémon Adventures", units: 1 });
    expect((await fetch(`${base}/api/v1/search?q=pokemon`)).status).toBe(401);
  });

  it("describes every route in OpenAPI, and llms.txt points agents at it", async () => {
    const { base } = await start();
    const spec = await (await fetch(`${base}/api/v1/openapi.json`)).json();   // public: it describes the program
    expect(spec.openapi).toBe("3.1.0");
    const src = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const routes = [...src.matchAll(/route\("(\w+)", "([^"]+)"/g)]
      .map(([, method, path]) => [method!.toLowerCase(), path!.replace(/:(\w+)/g, "{$1}")] as const)
      .filter(([, path]) => path.startsWith("/api/v1/") && path !== "/api/v1/openapi.json");
    const missing = routes.filter(([method, path]) => !spec.paths[path]?.[method]);
    expect(missing).toEqual([]);
    expect(Object.keys(openapi("1.0.0").paths as object).length).toBeGreaterThan(20);
    const llms = await (await fetch(`${base}/llms.txt`)).text();
    expect(llms).toContain(`${base}/mcp`);
    for (const name of toolNames) expect(llms).toContain(name);
  });

  it("speaks MCP: initialize, list the tools, call them", async () => {
    const { rpc, call } = await start();
    const unauth = await rpc("initialize", {}, false);
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("Bearer");

    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "archivist" }, capabilities: { tools: {} } });
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-11-25");

    const tools = (await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(toolNames);

    const found = await call("search_library", { query: "berserk" });
    expect(found.structuredContent.results[0].id).toBe("pages/berserk");
    const w = await call("get_work", { work: "pages/berserk" });
    expect(w.structuredContent.unitList).toHaveLength(1);
    const unit = w.structuredContent.unitList[0].key;

    const page = await call("get_page", { work: "pages/berserk", unit, page: 2, max_width: 0 });
    expect(page.content[0].text).toBe(`Page 2 of 2 (pages/berserk, ${unit}).`);
    expect(page.content[1]).toMatchObject({ type: "image", mimeType: "image/png", data: PNG.toString("base64") });
    const tooFar = await call("get_page", { work: "pages/berserk", unit, page: 9 });
    expect(tooFar).toMatchObject({ isError: true, content: [{ text: "page must be between 1 and 2" }] });

    await call("set_progress", { work: "pages/berserk", unit, position: 2, total: 2 });
    const progress = await call("get_progress", {});
    expect(progress.structuredContent.latest[0]).toMatchObject({ workId: "pages/berserk", finished: true, work: "Berserk" });
    expect((await call("list_works", { status: "finished" })).structuredContent.works.map((x: { id: string }) => x.id)).toEqual(["pages/berserk"]);
    expect((await call("list_works", { status: "unstarted" })).structuredContent.works).toHaveLength(1);
    expect((await call("recent_events", { since: 0 })).structuredContent.events.some((e: { type: string }) => e.type === "finished")).toBe(true);
    expect(await call("get_work", { work: "pages/nope" })).toMatchObject({ isError: true });
    expect(await call("get_progress", { profile: "nobody" })).toMatchObject({ isError: true });

    expect((await rpc("tools/call", { name: "rm_rf", arguments: {} })).body.error.code).toBe(-32602);
    expect((await rpc("nope/nope")).body.error.code).toBe(-32601);
    expect((await rpc("ping")).body.result).toEqual({});
  });

  it("acknowledges notifications without a body", async () => {
    const { base } = await start();
    const r = await fetch(`${base}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe("");
  });
});

describe("DNS rebinding", () => {
  it("lets a trusted network in only under a name a person at home would use", async () => {
    const { port } = await start("loopback");
    const get = (host: string) => new Promise<number>((resolve, reject) => {
      request({ host: "127.0.0.1", port, path: "/api/v1/works", headers: { host } }, (res) => { res.resume(); resolve(res.statusCode!); })
        .on("error", reject).end();
    });
    expect(await get(`127.0.0.1:${port}`)).toBe(200);
    expect(await get(`localhost:${port}`)).toBe(200);
    expect(await get(`valensrv:${port}`)).toBe(200);
    expect(await get(`valensrv.tail1234.ts.net`)).toBe(200);
    expect(await get(`evil.example.com:${port}`)).toBe(401);
  });
});

describe("who is asking", () => {
  const req = (socket: string, headers: Record<string, string> = {}) =>
    ({ socket: { remoteAddress: socket }, headers }) as unknown as IncomingMessage;

  it("reads the real address only from a known proxy, and never trusts a forwarded request", () => {
    // cloudflared on this machine
    expect(clientOf(req("127.0.0.1", { "cf-connecting-ip": "198.51.100.7", "cf-visitor": '{"scheme":"https"}' })))
      .toEqual({ ip: "198.51.100.7", proxied: true, https: true });
    // a proxy in Docker, declared in ARCHIVIST_PROXIES
    const docker = trustedNetworks("172.17.0.0/16", "ARCHIVIST_PROXIES");
    expect(clientOf(req("::ffff:172.17.0.1", { "x-forwarded-for": "203.0.113.5, 172.17.0.1", "x-forwarded-proto": "https" }), docker))
      .toEqual({ ip: "203.0.113.5", proxied: true, https: true });
    // the same proxy, not declared: still not trusted, but its header isn't believed either
    expect(clientOf(req("172.17.0.1", { "x-forwarded-for": "203.0.113.5" })))
      .toEqual({ ip: "172.17.0.1", proxied: true, https: false });
    // someone on the LAN making up a header gets nothing for it
    expect(clientOf(req("192.168.100.20", { "x-forwarded-for": "127.0.0.1" }))).toMatchObject({ ip: "192.168.100.20", proxied: true });
    expect(clientOf(req("192.168.100.20"))).toEqual({ ip: "192.168.100.20", proxied: false, https: false });
  });

  it("knows the names a person at home would type", () => {
    for (const h of ["192.168.100.3:8780", "[::1]:8780", "localhost", "valensrv:8780", "valensrv.tail1234.ts.net", "nas.local"]) {
      expect(localHost(h)).toBe(true);
    }
    for (const h of ["evil.example.com", "archivist.example.com", "1.2.3.4.nip.io", undefined]) expect(localHost(h)).toBe(false);
    expect(localHost("archivist.example.com", ["archivist.example.com"])).toBe(true);
  });
});
