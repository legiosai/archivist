# Changelog

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
