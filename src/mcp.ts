/**
 * archivist as an MCP server (Model Context Protocol, Streamable HTTP transport), so an agent can
 * find a work, look at a page or a frame, and read or save where someone is. POST /mcp with one
 * JSON-RPC message, answered with plain JSON; stateless (no session id, no server-sent stream).
 * Same auth as the API: the bearer token, or a trusted network.
 *
 * What it hands out follows SOUL.md: pages one at a time and single frames, never a clip, never
 * the audio, never a whole file.
 */
import type { ServerResponse } from "node:http";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** What the server lends the tools; each function takes the profile whose progress it reads. */
export interface Catalog {
  version: string;
  search(query: string, type: string | undefined, limit: number, profile: string): unknown;
  works(type: string | undefined, status: string | undefined, profile: string): unknown[];
  work(id: string, profile: string): unknown | null;
  progress(profile: string): unknown;
  saveProgress(id: string, unit: string, position: number, total: number, profile: string): unknown;
  pages(id: string, unit: string): Promise<number>;
  page(id: string, unit: string, n: number, maxWidth: number): Promise<{ type: string; data: Buffer }>;
  duration(id: string, unit: string): Promise<number>;
  frame(id: string, unit: string, seconds: number, maxWidth: number): Promise<Buffer>;
  events(since: number): unknown;
  profiles(): unknown;
  profileExists(id: string): boolean;
}

type Json = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
interface ToolResult { content: Content[]; structuredContent?: Json; isError?: boolean }

class ToolError extends Error {}

const str = (description: string, extra: Json = {}) => ({ type: "string", description, ...extra });
const num = (description: string, extra: Json = {}) => ({ type: "number", description, ...extra });
const PROFILE = str("Whose progress to use (a profile id from list_profiles). Default: the owner.");
const WORK = str('A work id as search_library or list_works return it, e.g. "pages/berserk" or "video/dark".');
const UNIT = str('A unit key from get_work: "v01" (a volume), "s01e02" (an episode), "film".');
const TYPE = { type: "string", enum: ["film", "series", "anime", "manga", "comic"], description: "Only works of this type." };

const TOOLS = [
  {
    name: "search_library", title: "Search the library",
    description: "Find works by title (any language, accents optional), original title, year or a database id. "
      + "Best first call when you have a name. Returns the matching works with their progress.",
    inputSchema: { type: "object", properties: { query: str("What to look for."), type: TYPE,
      limit: num("At most this many results (default 10).", { minimum: 1, maximum: 50 }), profile: PROFILE },
      required: ["query"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_works", title: "List works",
    description: "Every work in the library with how many units it has and how many are finished, sorted by title. "
      + "Filter by type, or by status: reading (started, not done), finished, unstarted.",
    inputSchema: { type: "object", properties: { type: TYPE,
      status: { type: "string", enum: ["reading", "finished", "unstarted"], description: "Only works in this state." },
      profile: PROFILE } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_work", title: "Get a work",
    description: "One work with all its units (volumes, episodes or the film), each with its format and the saved "
      + "position. Use the unit keys with get_page, get_frame and set_progress.",
    inputSchema: { type: "object", properties: { work: WORK, profile: PROFILE }, required: ["work"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_progress", title: "Where someone is",
    description: "What a profile is reading or watching: the last unit touched in each work, newest first, "
      + "with the position (page number, or seconds for video) and whether it is finished.",
    inputSchema: { type: "object", properties: { profile: PROFILE } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_progress", title: "Save a position",
    description: "Save where a profile is in a unit: a page number out of the page count, or seconds out of the "
      + "running time. A unit counts as finished on its last page or at 95 % of a video.",
    inputSchema: { type: "object", properties: { work: WORK, unit: UNIT,
      position: num("Page number (from 1) or seconds.", { minimum: 0 }),
      total: num("Page count or running time in seconds.", { minimum: 0 }), profile: PROFILE },
      required: ["work", "unit", "position", "total"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_page", title: "Look at a page",
    description: "One page of a volume (manga, comic) as an image, scaled down to max_width pixels wide "
      + "(default 1200). Pages are numbered from 1; the result says how many there are.",
    inputSchema: { type: "object", properties: { work: WORK, unit: UNIT,
      page: num("Page number, from 1.", { minimum: 1 }),
      max_width: num("Scale the page down to this width (default 1200, 0 = as stored).", { minimum: 0, maximum: 4000 }) },
      required: ["work", "unit", "page"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_frame", title: "Look at a frame",
    description: "A single still of a film or an episode at a time in seconds, as a JPEG. Never a clip or audio. "
      + "The result says the running time.",
    inputSchema: { type: "object", properties: { work: WORK, unit: UNIT,
      seconds: num("Time in seconds from the start.", { minimum: 0 }),
      max_width: num("Scale the frame down to this width (default 1280, 0 = as decoded).", { minimum: 0, maximum: 4000 }) },
      required: ["work", "unit", "seconds"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "recent_events", title: "What happened",
    description: "Events after an id: a unit finished (with whose), a work added or removed. "
      + "Pass the last id you saw to follow along.",
    inputSchema: { type: "object", properties: { since: num("Only events with a larger id (default 0).", { minimum: 0 }) } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_profiles", title: "List profiles",
    description: "Who reads here: one profile per person, each with its own progress. The first is the owner's.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
];

const INSTRUCTIONS = "archivist is a personal library of films, series, anime, manga and comics, with where each "
  + "person stopped. Find a work with search_library, open it with get_work to see its units, then look at pages "
  + "(get_page) or frames (get_frame). Progress is per profile; without one it is the owner's. Single pages and "
  + "frames only: there is no way to get a clip, the audio or a whole file, by design.";

function text(value: unknown, structured = true): ToolResult {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text", text: body }],
    ...(structured && value && typeof value === "object" && !Array.isArray(value) ? { structuredContent: value as Json } : {}) };
}

function arg(args: Json, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`${name} is required`);
  return v.trim();
}

function number(args: Json, name: string, fallback?: number): number {
  const v = args[name] ?? fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new ToolError(`${name} must be a number ≥ 0`);
  return n;
}

async function call(cat: Catalog, name: string, args: Json, fallbackProfile: string): Promise<ToolResult> {
  const profile = typeof args.profile === "string" && args.profile ? args.profile.toLowerCase() : fallbackProfile;
  if (!cat.profileExists(profile)) throw new ToolError(`unknown profile ${profile}; see list_profiles`);
  const type = typeof args.type === "string" && args.type ? args.type : undefined;
  switch (name) {
    case "search_library":
      return text({ results: cat.search(arg(args, "query"), type, Math.min(50, number(args, "limit", 10) || 10), profile) });
    case "list_works": {
      const status = typeof args.status === "string" && args.status ? args.status : undefined;
      return text({ works: cat.works(type, status, profile) });
    }
    case "get_work": {
      const w = cat.work(arg(args, "work"), profile);
      if (!w) throw new ToolError("unknown work; use search_library to find its id");
      return text(w);
    }
    case "get_progress":
      return text(cat.progress(profile));
    case "set_progress":
      return text(cat.saveProgress(arg(args, "work"), arg(args, "unit"), number(args, "position"), number(args, "total"), profile));
    case "get_page": {
      const id = arg(args, "work"), unit = arg(args, "unit"), n = number(args, "page");
      const count = await cat.pages(id, unit);
      if (!Number.isInteger(n) || n < 1 || n > count) throw new ToolError(`page must be between 1 and ${count}`);
      const page = await cat.page(id, unit, n, number(args, "max_width", 1200));
      return { content: [{ type: "text", text: `Page ${n} of ${count} (${id}, ${unit}).` },
        { type: "image", data: page.data.toString("base64"), mimeType: page.type }] };
    }
    case "get_frame": {
      const id = arg(args, "work"), unit = arg(args, "unit"), t = number(args, "seconds");
      const duration = await cat.duration(id, unit);
      if (duration && t > duration) throw new ToolError(`seconds must be at most the running time, ${Math.floor(duration)}`);
      const img = await cat.frame(id, unit, t, number(args, "max_width", 1280));
      return { content: [{ type: "text", text: `Frame at ${t.toFixed(1)} s of ${Math.round(duration)} s (${id}, ${unit}).` },
        { type: "image", data: img.toString("base64"), mimeType: "image/jpeg" }] };
    }
    case "recent_events":
      return text(cat.events(number(args, "since", 0)));
    case "list_profiles":
      return text(cat.profiles());
    default:
      throw new RpcError(-32602, `unknown tool ${name}`);
  }
}

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

async function handle(cat: Catalog, msg: unknown, profile: string): Promise<Json | null> {
  const m = (msg && typeof msg === "object" ? msg : {}) as Json;
  const id = m.id as string | number | null | undefined;
  const reply = (body: Json) => ({ jsonrpc: "2.0", id: id ?? null, ...body });
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    // A response or garbage: nothing to answer unless it looked like a request.
    return id === undefined ? null : reply({ error: { code: -32600, message: "invalid request" } });
  }
  if (id === undefined) return null;                        // a notification (initialized, cancelled …)
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  try {
    switch (m.method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        return reply({ result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "archivist", title: "archivist", version: cat.version },
          instructions: INSTRUCTIONS,
        } });
      }
      case "ping":
        return reply({ result: {} });
      case "tools/list":
        return reply({ result: { tools: TOOLS } });
      case "tools/call": {
        const name = String(params.name ?? "");
        const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Json;
        try {
          return reply({ result: await call(cat, name, args, profile) });
        } catch (err) {
          if (err instanceof RpcError) throw err;
          // Tool errors go back to the model as a result it can read and correct, not as a protocol error.
          const known = err instanceof ToolError || (err as { status?: number }).status !== undefined;
          if (!known) console.error("mcp tool failed", name, err);
          return reply({ result: { content: [{ type: "text", text: known ? (err as Error).message : "the tool failed" }], isError: true } });
        }
      }
      case "resources/list":
        return reply({ result: { resources: [] } });
      case "prompts/list":
        return reply({ result: { prompts: [] } });
      default:
        throw new RpcError(-32601, `method not found: ${m.method}`);
    }
  } catch (err) {
    const code = err instanceof RpcError ? err.code : -32603;
    return reply({ error: { code, message: err instanceof RpcError ? err.message : "internal error" } });
  }
}

/** POST /mcp: one message (or, from older clients, a batch); GET and DELETE are not offered. */
export async function serveMcp(res: ServerResponse, cat: Catalog, body: unknown, profile: string): Promise<void> {
  const out = Array.isArray(body)
    ? (await Promise.all(body.map((m) => handle(cat, m, profile)))).filter((r) => r !== null)
    : await handle(cat, body, profile);
  if (out === null || (Array.isArray(out) && !out.length)) {
    res.writeHead(202);
    res.end();
    return;
  }
  const data = JSON.stringify(out);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
}

export const toolNames = TOOLS.map((t) => t.name);
