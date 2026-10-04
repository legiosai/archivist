# Changelog

## 0.3.0 — 2026-10-03

- Profiles: each person in the house keeps their own place in every work. "¿Quién lee?" when
  there is more than one, a switcher in the header, and a page to add, rename or remove them.
  The API takes the profile from `X-Archivist-Profile` / `?profile=`, the browser cookie, or the
  OPDS user name. A 0.1/0.2 database is migrated: its progress becomes the owner's.

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
