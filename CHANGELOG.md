# Changelog

## 0.7.0 — 2026-10-06

- A new look. Home opens on a full-width picture of what you're in the middle of, with "Seguir"
  going straight back to the page or the second; then a row per type. Videos without a poster of
  their own show wide, as a frame, instead of a frame cropped tall. "Seguir" shows the very frame
  or page where you stopped. The grid with filters moved to "Ver todo" (`#/todo`).
- A work's page sits on its own wide picture too, with compact actions; a film in one file no
  longer lists its one file.
- The player has its own controls: the title on top, a scrubber that shows the frame under the
  pointer, ten seconds back and forward, volume, the next episode, audio and subtitles,
  fullscreen. They hide while it plays; keys: space or k, the arrows or j and l, f, m, c. On a
  phone, a tap shows them and two taps on a side move ten seconds. Subtitles move up while the
  controls show.
- The reader's direction and double page live in a small menu instead of the browser's own select
  and checkbox, and the page bar has buttons on both sides.
- On a phone, the sections are a tab bar at the bottom.
- `GET /api/v1/works/…/backdrop` (TMDB's backdrop, AniList's banner, or the best frame of the first
  act) and `backdrop` on every work; `?w=` goes up to 1280.

## 0.6.0 — 2026-10-06

- Posters: a work's own `poster.jpg` (or `folder.jpg`; `<film>-poster.jpg` beside a film) is its
  cover, and never taken for a page. From the work's page, "Portada y datos" uploads one or makes
  it from any of twelve frames of the video. `PUT`/`DELETE /api/v1/works/…/poster`,
  `POST …/poster/frame`.
- Details and posters from TMDB (films, series) and AniList (anime, manga), off unless
  `ARCHIVIST_METADATA` turns them on: the synopsis, genres, director or author or studio, the
  running time, and a poster kept in the cache. A work is found by the ids in its yaml, else by
  title and year only when both agree; the owner can search and pick another, or say it's none.
  The browser never talks to them: candidates' posters come through `/api/v1/meta/thumb`.
  The yaml's own `overview`, `genres`, `director`/`author`/`studio` always win.
- Audio and subtitles: every audio track and every text subtitle inside the file (SRT, ASS,
  WebVTT, mov_text), besides the files beside it. Another audio track is prepared once as its
  own copy. The choice is per profile and work, by language, so it carries to the next episode.
  `?audio=` on `info`, `video` and `prepare`; `subtitles/e0…`; `GET`/`PUT /api/v1/works/…/tracks`.
- Upload: a drop zone that takes files and whole folders, real buttons instead of the browser's,
  and a list with each file's progress, the speed and the time left; files the work can't take
  are pointed out before sending.
- Tu año: each profile's year — time watched, pages read, units and works finished, days with
  something, the longest streak, month by month and what kept them busiest. Time is logged from
  now on as positions move forward (a jump ahead doesn't count); earlier progress counts once.
  `GET /api/v1/stats?year=`.
- Installable: a web manifest and icons.

## 0.5.1 — 2026-10-06

- HDR video (a UHD Blu-ray transfer, PQ or HLG) no longer comes out grey and washed out: frames,
  covers, thumbnails and the copy the player gets are tone-mapped to SDR BT.709. An HDR H.264 file
  is converted instead of copied.
- A film's or an episode's cover is the most detailed of four moments in the first act, not one
  fixed frame that could land on black.

## 0.5.0 — 2026-10-04

- Profiles up front: a browser that hasn't chosen one opens on "¿Quién está mirando?", and it
  remembers the link it was opened with. A profile menu in the header switches in one click.
- Avatars: each profile picks a color and an emoji (or keeps its initial). `hue` and `glyph` on
  `POST`/`PATCH /api/v1/profiles`; `GET` adds each profile's stats (works under way, units
  finished, last activity). Databases from 0.4 are migrated.
- Perfiles page: a card per person with their stats, an editor with a live preview, and a
  button that copies their OPDS catalog for the phone.
- Search from anywhere: Ctrl+K / ⌘K or the header button, with what you were reading when
  empty.
- Library: filter by state (en curso, sin empezar, terminadas), sort by recent, title or year,
  a greeting with the profile's name, and "Sorprendeme" for a profile that hasn't started.

## 0.4.0 — 2026-10-04

- For agents: an MCP server at `/mcp` (Streamable HTTP, stateless, the same token) with nine
  tools: search the library, list and open works, look at a page or a frame (scaled down for a
  model), read and save progress, follow events, list profiles. `/api/v1/search`, an OpenAPI 3.1
  document at `/api/v1/openapi.json`, and `/llms.txt`.
- Safe to publish behind a reverse proxy: a request with forwarding headers is never trusted
  (and its client address is read only from `ARCHIVIST_PROXIES`, loopback by default), browser sessions
  replace the token in the cookie (revocable from Perfiles), wrong tokens are logged with the
  real address and limited to 10 per 15 minutes, hardening headers and HSTS, DNS rebinding
  closed, and video stays home unless `ARCHIVIST_PROXIED_VIDEO=on`.
- A new look: Fraunces and Inter (bundled, no font CDN), a "continue" hero with the cover's
  colors, glass header, covers with type badges and progress, volumes and episodes as cards
  with their own thumbnails, seasons as tabs, skeletons while loading, colored profiles.
- Smaller images for grids: `?w=` on covers, pages and frames (cached), and `?at=` for a frame
  at a share of the running time.
- Fix: two requests for the same frame at once could fail.
- Upgrading: browsers log in once more (the old token cookie is no longer read).

## 0.3.0 — 2026-10-03

- Profiles: each person in the house keeps their own place in every work. "¿Quién lee?" when
  there is more than one, a switcher in the header, and a page to add, rename or remove them.
  The API takes the profile from `X-Archivist-Profile` / `?profile=`, the browser cookie, or the
  OPDS user name. A 0.1/0.2 database is migrated: its progress becomes the owner's.
- A catalog per profile, `/opds?profile=sol`, for readers on a trusted network (they send no
  user name): the profile rides on every link of that catalog.

## 0.2.0 — 2026-10-03

- OPDS 1.2 catalog at `/opds` for phone readers (Panels, Chunky, KOReader, Mihon): continue,
  per type, everything; each volume downloadable and streamable page by page (PSE). Pages read
  through PSE save the position.
- HTTP Basic auth (the token as the password), which is what OPDS readers speak.
- Trusted networks (`ARCHIVIST_TRUSTED`): no token from Tailscale or the home network.
- `GET /api/v1/units/…/file`: a volume's own CBZ/ZIP/PDF.
- Daily database snapshots (`ARCHIVIST_BACKUP_DIR`).
- Landing at archivist.legios.com.ar.

## 0.1.0 — 2026-10-03

First version.

- Library from folders: films, series and anime (one unit per episode, with subtitles), manga
  and comics (CBZ, ZIP, PDF or folders of images, one unit per volume). Works can be created
  from the UI before their first file.
- Reader: right-to-left, left-to-right, vertical and double page; keyboard, taps and swipes;
  pages read out of the archive without extracting it; PDF pages rendered once and cached.
- Player: direct play with HTTP ranges; anything else converted once to H.264/AAC (NVENC when
  the GPU has it); subtitles as WebVTT; next episode.
- Progress per unit (page or second), a "continue" shelf, and an event log of finished units.
- Resumable uploads of files and folders.
- API with a token for tools; single frames and pages, never clips.
- Docker image and a systemd user unit.
