/**
 * The API described for machines: an OpenAPI 3.1 document at /api/v1/openapi.json, and a short
 * plain-text guide for agents at /llms.txt. Both are public (they describe the open-source
 * program, not the library) and both are written by hand next to the routes in server.ts: when a
 * route changes, change it here too (test/agents.test.ts checks every route is listed).
 */

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: Json) => ({ required: true, content: { "application/json": { schema } } });
const ok = (description: string, schema?: Json, type = "application/json") =>
  ({ description, ...(schema ? { content: { [type]: { schema } } } : {}) });
const image = (description: string) => ({ description, content: { "image/*": { schema: { type: "string", format: "binary" } } } });
const path = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });
const query = (name: string, description: string, schema: Json = { type: "string" }) => ({ name, in: "query", description, schema });

const WORK = [path("kind", "`pages`, `video` or `stills`."), path("slug", "The work's folder name.")];
const UNIT = [...WORK, path("unit", "A unit key: `v01`, `s01e02`, `film`.")];
const LOOK = { name: { type: "string" }, hue: { type: ["integer", "null"], minimum: 0, maximum: 359, description: "The avatar's color." },
  glyph: { type: ["string", "null"], description: "One emoji for the avatar; null for the initial." } };
const PROFILE = query("profile", "Whose progress (a profile id); also the `X-Archivist-Profile` header. Default: the owner.");

function op(tag: string, summary: string, extra: Json = {}, responses: Json = { 200: ok("OK") }): Json {
  return { tags: [tag], summary, ...extra, responses: { ...responses, 401: ok("Token required") } };
}

export function openapi(version: string, server?: string): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "archivist", version,
      summary: "A personal library of films, series, anime, manga and comics, with where each person stopped.",
      description: "Pages one at a time and single frames; there is no endpoint for a clip, the audio or a whole video, on purpose. "
        + "Agents can also use the MCP server at /mcp (same token).",
      license: { name: "MIT", identifier: "MIT" },
    },
    ...(server ? { servers: [{ url: server }] } : {}),
    security: [{ bearer: [] }],
    tags: ["works", "units", "progress", "profiles", "uploads", "session"].map((name) => ({ name })),
    paths: {
      "/api/v1/health": { get: { ...op("session", "Liveness, and whether this client needs a token", { security: [] }), responses: {
        200: ok("OK", { type: "object", properties: { ok: { type: "boolean" }, works: { type: "integer" }, open: { type: "boolean" } } }) } } },
      "/api/v1/login": { post: op("session", "Trade the token for a browser session cookie", {
        security: [], requestBody: jsonBody({ type: "object", required: ["token"], properties: { token: { type: "string" } } }) },
        { 200: ok("Logged in; sets `archivist_session`"), 429: ok("Too many failed attempts") }) },
      "/api/v1/logout": { post: op("session", "End this browser session", { security: [] }) },
      "/api/v1/sessions": {
        get: op("session", "Browser sessions: when, from where, which browser"),
        delete: op("session", "End every browser session (log out everywhere)"),
      },
      "/api/v1/search": { get: op("works", "Find works by title, original title, year or id", { parameters: [
        query("q", "What to look for.", { type: "string" }), query("type", "Only this type.", ref("WorkType")),
        query("limit", "At most this many (default 20).", { type: "integer", minimum: 1, maximum: 100 }), PROFILE] },
      { 200: ok("Matches, best first", { type: "object", properties: { results: { type: "array", items: {
        allOf: [ref("Work"), { type: "object", properties: { score: { type: "integer" } } }] } } } }) }) },
      "/api/v1/works": {
        get: op("works", "Every work, sorted by title", { parameters: [PROFILE] },
          { 200: ok("Works", { type: "object", properties: { works: { type: "array", items: ref("Work") } } }) }),
        post: op("works", "Create a work (its folder and work.yaml) to upload into", { requestBody: jsonBody({ type: "object",
          required: ["title", "type"], properties: { title: { type: "string" }, type: ref("WorkType"), year: { type: "integer" },
            originalTitle: { type: "string" }, ids: { type: "object", additionalProperties: { type: "string" } }, slug: { type: "string" } } }) },
        { 201: ok("Created", ref("WorkDetail")), 400: ok("Invalid") }),
      },
      "/api/v1/works/{kind}/{slug}": { get: op("works", "One work with its units and their progress", { parameters: [...WORK, PROFILE] },
        { 200: ok("The work", ref("WorkDetail")), 404: ok("Unknown work") }) },
      "/api/v1/works/{kind}/{slug}/cover": { get: op("works", "Cover image: the first page, or the most detailed of a few frames from the first act of the first video",
        { parameters: [...WORK, query("w", "A smaller copy this many pixels wide (snaps to 160, 320, 480, 640 or 960), cached.", { type: "integer" })] }, { 200: image("The cover") }) },
      "/api/v1/rescan": { post: op("works", "Read the folders again now") },
      "/api/v1/units/{kind}/{slug}/{unit}/pages": { get: op("units", "Page count", { parameters: UNIT },
        { 200: ok("Count", { type: "object", properties: { count: { type: "integer" } } }) }) },
      "/api/v1/units/{kind}/{slug}/{unit}/pages/{n}": { get: op("units", "One page (from 1), as stored or scaled with ?w=", {
        parameters: [...UNIT, path("n", "Page number, from 1."), query("w", "A smaller copy this many pixels wide (snaps to 160, 320, 480, 640 or 960), cached.", { type: "integer" })] }, { 200: image("The page"), 404: ok("No such page") }) },
      "/api/v1/units/{kind}/{slug}/{unit}/info": { get: op("units", "A video's running time, whether it plays now, and its subtitles",
        { parameters: UNIT }, { 200: ok("Info", { type: "object", properties: { duration: { type: "number" }, ready: { type: "boolean" },
          allowed: { type: "boolean", description: "False through the public proxy unless ARCHIVIST_PROXIED_VIDEO is on." },
          subtitles: { type: "array", items: { type: "object" } } } }) }) },
      "/api/v1/units/{kind}/{slug}/{unit}/frame": { get: op("units", "One still at `t` seconds, as JPEG (never a clip)", {
        parameters: [...UNIT, query("t", "Seconds from the start.", { type: "number", minimum: 0 }),
        query("at", "Or a share of the running time, 0 to 1.", { type: "number", minimum: 0, maximum: 1 }), query("w", "A smaller copy this many pixels wide (snaps to 160, 320, 480, 640 or 960), cached.", { type: "integer" })] }, { 200: image("The frame") }) },
      "/api/v1/units/{kind}/{slug}/{unit}/video": { get: op("units", "The video for the player, with HTTP ranges", { parameters: UNIT },
        { 200: ok("Video", undefined), 206: ok("Partial"), 403: ok("Not served through the public proxy"), 409: ok("Still converting") }) },
      "/api/v1/units/{kind}/{slug}/{unit}/prepare": { post: op("units", "Convert a video the browser can't play (once, in the background)",
        { parameters: UNIT }, { 202: ok("Job started"), 403: ok("Not through the public proxy") }) },
      "/api/v1/units/{kind}/{slug}/{unit}/subtitles/{i}": { get: op("units", "A subtitle file as WebVTT", {
        parameters: [...UNIT, path("i", "Subtitle index from info.")] }, { 200: ok("WebVTT", { type: "string" }, "text/vtt") }) },
      "/api/v1/units/{kind}/{slug}/{unit}/file": { get: op("units", "A volume's own file (CBZ, ZIP, PDF) to download", { parameters: UNIT },
        { 200: ok("The file", { type: "string", format: "binary" }, "application/octet-stream") }) },
      "/api/v1/progress": { get: op("progress", "Where a profile is: the last unit of each work, and every saved position",
        { parameters: [PROFILE] }, { 200: ok("Progress", { type: "object", properties: { profile: { type: "string" },
          latest: { type: "array", items: ref("Progress") }, all: { type: "array", items: ref("Progress") } } }) }) },
      "/api/v1/progress/{kind}/{slug}/{unit}": { put: op("progress", "Save a position: a page out of the count, or seconds out of the duration", {
        parameters: [...UNIT, PROFILE], requestBody: jsonBody({ type: "object", required: ["position", "total"],
          properties: { position: { type: "number", minimum: 0 }, total: { type: "number", minimum: 0 } } }) },
      { 200: ok("Saved", { type: "object", properties: { progress: ref("Progress"), newlyFinished: { type: "boolean" } } }) }) },
      "/api/v1/events": { get: op("progress", "Events after an id: finished, work_added, work_removed", {
        parameters: [query("since", "Only events with a larger id.", { type: "integer", minimum: 0 })] }) },
      "/api/v1/profiles": {
        get: op("profiles", "Profiles with their avatar and stats (inProgress, finishedUnits, lastAt), and the one this request reads as"),
        post: op("profiles", "Add a profile", { requestBody: jsonBody({ type: "object", required: ["name"], properties: LOOK }) },
          { 201: ok("Created") }),
      },
      "/api/v1/profiles/{id}": {
        patch: op("profiles", "Rename or restyle; fields left out stay", { parameters: [path("id", "Profile id.")],
          requestBody: jsonBody({ type: "object", properties: LOOK }) }),
        delete: op("profiles", "Remove a profile and its progress (never the owner's)", { parameters: [path("id", "Profile id.")] }),
      },
      "/api/v1/profiles/{id}/use": { post: op("profiles", "Make it the browser's profile", { parameters: [path("id", "Profile id.")] }) },
      "/api/v1/uploads": { post: op("uploads", "Start a resumable upload into a work", { requestBody: jsonBody({ type: "object",
        required: ["workId", "path", "size"], properties: { workId: { type: "string" }, path: { type: "string" }, size: { type: "integer" } } }) },
      { 201: ok("Upload created") }) },
      "/api/v1/uploads/{id}": {
        head: op("uploads", "Where to continue (Upload-Offset)", { parameters: [path("id", "Upload id.")] }),
        patch: op("uploads", "The next bytes at Upload-Offset", { parameters: [path("id", "Upload id.")] }, { 204: ok("Stored"), 409: ok("Wrong offset") }),
        delete: op("uploads", "Cancel", { parameters: [path("id", "Upload id.")] }),
      },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "ARCHIVIST_TOKEN" } },
      schemas: {
        WorkType: { type: "string", enum: ["film", "series", "anime", "manga", "comic"] },
        Work: { type: "object", properties: {
          id: { type: "string", examples: ["pages/berserk"] }, slug: { type: "string" }, kind: { type: "string", enum: ["pages", "video", "stills"] },
          type: ref("WorkType"), title: { type: "string" }, year: { type: ["integer", "null"] }, originalTitle: { type: ["string", "null"] },
          ids: { type: "object" }, reading: { type: ["string", "null"], enum: ["rtl", "ltr", "vertical", null] },
          units: { type: "integer" }, finished: { type: "integer" }, last: { oneOf: [ref("Progress"), { type: "null" }] },
          cover: { type: ["string", "null"] } } },
        WorkDetail: { allOf: [ref("Work"), { type: "object", properties: { unitList: { type: "array", items: ref("Unit") } } }] },
        Unit: { type: "object", properties: { key: { type: "string" }, label: { type: "string" },
          format: { type: "string", enum: ["video", "cbz", "zip", "pdf", "images"] }, season: { type: ["integer", "null"] },
          episode: { type: ["integer", "null"] }, volume: { type: ["integer", "null"] }, subtitles: { type: "integer" },
          progress: { oneOf: [ref("Progress"), { type: "null" }] }, href: { type: "string" } } },
        Progress: { type: "object", properties: { profile: { type: "string" }, workId: { type: "string" }, unitKey: { type: "string" },
          position: { type: "number" }, total: { type: "number" }, finished: { type: "boolean" }, updatedAt: { type: "string", format: "date-time" } } },
      },
    },
  };
}

export function llmsTxt(base: string): string {
  return `# archivist

> A personal library of films, series, anime, manga and comics, with a reader, a player, and
> where each person stopped. Open source (MIT): https://github.com/legiosai/archivist

Everything needs the owner's token: \`Authorization: Bearer <token>\`.

## For agents

- MCP server (Streamable HTTP): ${base}/mcp
  Tools: search_library, list_works, get_work, get_progress, set_progress, get_page, get_frame,
  recent_events, list_profiles.
  Claude Code: \`claude mcp add --transport http archivist ${base}/mcp --header "Authorization: Bearer $ARCHIVIST_TOKEN"\`
- OpenAPI 3.1: ${base}/api/v1/openapi.json
- Human docs: https://github.com/legiosai/archivist/blob/main/docs/api.md

## How it fits together

- A work's id is \`<kind>/<slug>\`: \`pages/berserk\`, \`video/dark\`. Its units are volumes (\`v01\`),
  episodes (\`s01e02\`) or the film (\`film\`).
- Find a work: GET /api/v1/search?q=berserk. Open it: GET /api/v1/works/pages/berserk.
- Look at a page: GET /api/v1/units/pages/berserk/v01/pages/1. A frame: GET /api/v1/units/video/dark/s01e01/frame?t=600.
- Progress belongs to a profile (\`?profile=\` or \`X-Archivist-Profile\`); without one it is the owner's.
  Save it: PUT /api/v1/progress/pages/berserk/v01 {"position": 12, "total": 200}.

## Limits, on purpose

Pages one at a time and single frames. No clips, no audio, no whole video files through tools.
`;
}
