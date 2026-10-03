# API

Everything the UI shows comes from this API, and a tool can use the same calls. JSON unless
noted. Every route but `/health` and `/login` asks for the token:

```
Authorization: Bearer $ARCHIVIST_TOKEN
```

Ids: a work is `<kind>/<slug>` (`pages/berserk`, `video/dark`); a unit is a key inside its work
(`film`, `s01e02`, `v03`, `stills`).

## Works

| | |
|---|---|
| `GET /api/v1/works` | Every work: `id, kind, type, title, year, ids, reading, units, finished, last, cover`. |
| `GET /api/v1/works/:kind/:slug` | One work, plus `unitList` with each unit's progress. |
| `POST /api/v1/works` | Create one: `{title, type, year?, originalTitle?, ids?, slug?}` → its folder and `work.yaml`. |
| `GET /api/v1/works/:kind/:slug/cover` | An image: the first page, or a frame at 10 % of the first video. |
| `POST /api/v1/rescan` | Read the folders again now (they are also read every 5 minutes and after an upload). |

## Units

| | |
|---|---|
| `GET /api/v1/units/:kind/:slug/:unit/pages` | `{count}` |
| `GET /api/v1/units/:kind/:slug/:unit/pages/:n` | Page `n` (1-based), as an image. |
| `GET /api/v1/units/:kind/:slug/:unit/info` | Video: `{duration, ready, job, subtitles}`. |
| `POST /api/v1/units/:kind/:slug/:unit/prepare` | Video the browser can't play: start converting it once (ffmpeg). |
| `GET /api/v1/units/:kind/:slug/:unit/video` | The video, with HTTP ranges; `409 {preparing, progress}` while it converts. |
| `GET /api/v1/units/:kind/:slug/:unit/frame?t=SECONDS` | One frame as JPEG. |
| `GET /api/v1/units/:kind/:slug/:unit/subtitles/:i` | A subtitle file as WebVTT. |

Tools get pages and single frames. There is no endpoint that cuts a clip, on purpose
([SOUL.md](../SOUL.md)).

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

## Example

```sh
T=$ARCHIVIST_TOKEN
curl -H "Authorization: Bearer $T" http://archivist:8780/api/v1/works
curl -H "Authorization: Bearer $T" -o p1.jpg http://archivist:8780/api/v1/units/pages/berserk/v01/pages/1
curl -H "Authorization: Bearer $T" "http://archivist:8780/api/v1/events?since=0"
```
