# Changelog

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
