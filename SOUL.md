# SOUL.md — archivist

**Mission:** everything you own to read or watch, in one place, and it never
forgets where you stopped.

**Metric:** the fraction of a library's works that open on the exact page or
second where their owner left them, on any device on their network. A folder of
files scores 0: the file manager knows what you have, not where you are.

---

**Non-goals (locked):**

- **archivist never fetches the works.** No downloader, no scraper, no source
  list, no "add from URL". It reads files the owner already has on their own
  disk. Metadata (titles, covers, years) may come from TMDB or AniList; the
  pages and the frames never come from anywhere but the owner's files.
- **No account, no cloud, no telemetry.** It runs on the owner's machine and
  answers on their network. Nothing leaves it except the metadata lookups, each
  to the same public API a person would query by hand.
- **The folders are the truth.** The library is a layout on disk that a person
  can read, copy with rsync and back up without archivist running. The database
  holds what the disk cannot: where you are, what you finished, the metadata
  cache. Deleting it loses your place, never your files.
- **Read and watch are one product.** A manga and the anime of the same story are
  one work in two forms, with one "continue" shelf. Splitting them into two apps
  is the gap this exists to close.
- **The API is a first-class door, not an afterthought.** Every page the UI
  shows, a tool can ask for: works, chapters, episodes, a page, a frame at a
  second, the owner's progress. The first consumer is a video pipeline
  (VT-Showrunner) that tells the story of what its owner has read.
- **Stills, not clips.** The API serves pages and single frames. It does not
  serve cut segments of a video to other tools: playback is for the owner's own
  screen.
