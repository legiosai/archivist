# API

Everything the UI shows comes from this API, and a tool can use the same calls. JSON unless
noted. Every route but `/health`, `/login`, `/logout`, `/openapi.json` and `/llms.txt` asks for
the token:

```
Authorization: Bearer $ARCHIVIST_TOKEN
```

The same API, machine-readable: `GET /api/v1/openapi.json` (OpenAPI 3.1). For agents there is
also an MCP server; see [Agents](#agents).

Ids: a work is `<kind>/<slug>` (`pages/berserk`, `video/dark`); a unit is a key inside its work
(`film`, `s01e02`, `v03`, `stills`).

## Session

| | |
|---|---|
| `GET /api/v1/health` | `{ok, works, open}`; `open` says whether this client gets in without a token. |
| `POST /api/v1/login` | `{token}` → a browser session cookie (`archivist_session`, HttpOnly, 90 days from last use). |
| `POST /api/v1/logout` | Ends this browser's session. |
| `GET /api/v1/sessions` | Open sessions: `created_at, last_seen, ip, agent`. |
| `DELETE /api/v1/sessions` | Ends them all. |

After 10 wrong tokens in 15 minutes from one address, that address gets `429` with
`Retry-After` until the window ends.

## Works

| | |
|---|---|
| `GET /api/v1/search?q=&type=&limit=` | Works by title (accents optional), original title, year or id, best first, with `score`. |
| `GET /api/v1/works` | Every work: `id, kind, type, title, year, ids, reading, units, finished, last, cover`. |
| `GET /api/v1/works/:kind/:slug` | One work, plus `unitList` with each unit's progress. |
| `POST /api/v1/works` | Create one: `{title, type, year?, originalTitle?, ids?, slug?}` → its folder and `work.yaml`. |
| `GET /api/v1/works/:kind/:slug/cover` | An image: the first page, or the most detailed of a few frames from the first act of the first video. `?w=320` for a small copy. |
| `POST /api/v1/rescan` | Read the folders again now (they are also read every 5 minutes and after an upload). |

## Units

| | |
|---|---|
| `GET /api/v1/units/:kind/:slug/:unit/pages` | `{count}` |
| `GET /api/v1/units/:kind/:slug/:unit/pages/:n` | Page `n` (1-based), as an image; `?w=` for a small copy. |
| `GET /api/v1/units/:kind/:slug/:unit/info` | Video: `{duration, ready, allowed, job, subtitles}`; `allowed` is false through the public proxy (video stays home). |
| `POST /api/v1/units/:kind/:slug/:unit/prepare` | Video the browser can't play: start converting it once (ffmpeg). |
| `GET /api/v1/units/:kind/:slug/:unit/video` | The video, with HTTP ranges; `409 {preparing, progress}` while it converts. |
| `GET /api/v1/units/:kind/:slug/:unit/frame?t=SECONDS` | One frame as JPEG; `?at=0.1` for a share of the running time, `?w=` for a small copy. |
| `GET /api/v1/units/:kind/:slug/:unit/subtitles/:i` | A subtitle file as WebVTT. |
| `GET /api/v1/units/:kind/:slug/:unit/file` | The volume's own file (CBZ, ZIP, PDF), for download. |

Tools get pages and single frames. There is no endpoint that cuts a clip, on purpose
([SOUL.md](../SOUL.md)).

`?w=` snaps to 160, 320, 480, 640 or 960 pixels wide; each copy is made once and kept in the
cache folder.

## OPDS (readers on the phone)

`/opds` is an OPDS 1.2 catalog of the manga and comics, for apps like Panels, Chunky, KOReader
or Mihon. Readers log in with HTTP Basic: the profile as the user name, the token as the password
(or nothing, from a trusted network). From a trusted network a reader sends no user name, so
give each person their own catalog URL instead: `/opds?profile=sol` keeps `?profile=sol` on
every link it hands out.

| | |
|---|---|
| `GET /opds` | Root: "Seguir leyendo", one section per type, everything. |
| `GET /opds/continue`, `/opds/all`, `/opds/type/:type` | Works, with covers. |
| `GET /opds/w/:kind/:slug` | Its volumes: the file to download, and a Page Streaming Extension (PSE) link with the page count and the page you're on. |
| `GET /opds/pse/:kind/:slug/:unit/:n` | Page `n`, counted from 0 as PSE does. Fetching it saves your position, so the phone and the browser share one "continue".|

## Profiles

Each profile keeps its own place in every work. The first one is the owner's (named by
`ARCHIVIST_OWNER_NAME`, "Yo" by default). A request reads and writes the profile given by the
`X-Archivist-Profile` header or `?profile=`, else the browser's profile cookie, else the Basic auth
user name (so an OPDS reader logged in as `sol` reads as Sol), else the owner.

| | |
|---|---|
| `GET /api/v1/profiles` | `{profiles, current}`; each profile has `hue`, `glyph` and `stats: {inProgress, finishedUnits, lastAt}`. |
| `POST /api/v1/profiles` | `{name, hue?, glyph?}` → a new profile. |
| `PATCH /api/v1/profiles/:id` | Any of `{name, hue, glyph}`; what is left out stays. `hue` is 0–359 (the avatar's color), `glyph` one emoji or `null` for the initial. |
| `DELETE /api/v1/profiles/:id` | Removed with its progress (never the owner's). |
| `POST /api/v1/profiles/:id/use` | Sets the browser's profile cookie. |

## Progress

| | |
|---|---|
| `GET /api/v1/progress` | `{latest, all}`: the unit last touched in each work (newest first), and every unit's position. |
| `PUT /api/v1/progress/:kind/:slug/:unit` | `{position, total}`: a page number and the page count, or seconds and the duration. |
| `GET /api/v1/events?since=ID` | What happened after event `ID`: `finished` (a unit), `work_added`, `work_removed`. |

A unit is finished on its last page, or at 95 % of a video; reading it again keeps it finished.

## Uploads

Resumable, in the spirit of tus:

```
POST  /api/v1/uploads          {workId, path, size}   → 201 {id, offset: 0, target}
PATCH /api/v1/uploads/:id      Upload-Offset: N, body = the next bytes   → 204, Upload-Offset, Upload-Done
HEAD  /api/v1/uploads/:id      → Upload-Offset: where to continue after a cut
DELETE /api/v1/uploads/:id     → cancel
```

`path` is the file name, or `folder/file` for a volume uploaded as a folder of images. The
server decides where it goes inside the work and refuses what the work can't hold (a script in a
manga, a PDF in a series). A wrong offset gets `409`; ask with `HEAD` and continue from there.

## Agents

`POST /mcp` is an [MCP](https://modelcontextprotocol.io) server over Streamable HTTP: one
JSON-RPC message per request, answered with JSON (no sessions, no server-sent stream), with the
same token. `GET /llms.txt` is a short guide for a model.

```sh
claude mcp add --transport http archivist http://archivist:8780/mcp --header "Authorization: Bearer $ARCHIVIST_TOKEN"
```

| Tool | |
|---|---|
| `search_library` | `{query, type?, limit?, profile?}` → matching works with their progress. |
| `list_works` | `{type?, status?: reading \| finished \| unstarted, profile?}` |
| `get_work` | `{work, profile?}` → the work and its units (keys for the tools below). |
| `get_progress` | `{profile?}` → the last unit touched in each work. |
| `set_progress` | `{work, unit, position, total, profile?}` |
| `get_page` | `{work, unit, page, max_width?}` → the page as an image (1200 px wide by default). |
| `get_frame` | `{work, unit, seconds, max_width?}` → one still as JPEG. |
| `recent_events` | `{since?}` → finished units, works added or removed. |
| `list_profiles` | `{}` |

A tool that can't do what it was asked answers with `isError` and a sentence the model can act
on ("page must be between 1 and 214"). Nothing returns a clip, the audio or a whole file.

## Example

```sh
T=$ARCHIVIST_TOKEN
curl -H "Authorization: Bearer $T" http://archivist:8780/api/v1/works
curl -H "Authorization: Bearer $T" -o p1.jpg http://archivist:8780/api/v1/units/pages/berserk/v01/pages/1
curl -H "Authorization: Bearer $T" "http://archivist:8780/api/v1/events?since=0"
```
