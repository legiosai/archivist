# Changelog

## 0.11.0 — 2026-11-27

- A book opens on the lines where you left it, not at the top of that page. With the page fitted
  to the text a page is two or three screens long, so "the page" was no longer a place. The viewer
  now saves how far down the page the first line on screen was, a moment after the page stops
  moving and at once when the screen goes away (a phone locked, another app), and puts those lines
  back under the bar on any device and at any zoom. A page asked for by its number still opens at
  its top. For tools it is `within` on a saved position: optional on
  `PUT /api/v1/progress/…`, `null` when only the page is known.
- The screen stays on while you read. A phone dims after a minute without a touch, and a page of
  a technical book takes longer than that. It lets go ten minutes after the last touch, key or
  scroll, so a phone left open on a table still sleeps. It needs https (the browser's rule).
- Answers are written as the model writes them, instead of a wait for the whole answer. The panel
  says whether the model is still reading the page or thinking, shows the words as they come,
  waits for a diagram or a chart to be complete before drawing it, and has a button to stop:
  what was written until then stays, and the model is told to stop writing. Through the API it is
  `stream: true` on `POST …/ask`, answered as server-sent events; without it nothing changes.
- The bar says which chapter you are in, under the book's name, and the index marks the entry
  being read, opens the chapters around it and opens on it. In a book divided in parts the bar
  names the chapter, not the part; in a chapter longer than 60 pages, the section.
- Books printed on both sides of the sheet read larger. Their left and right pages hold the words
  in different places, and one column over both was as wide as the two together. Now each side
  moves to the column: around 10 % larger words in "Think Python" and 8 % in "The Linux Command
  Line". Books with the same margins on every page are as before. The column is measured again
  the first time each book is opened.

## 0.10.0 — 2026-11-27

- A book on a phone is read, not squinted at. The page takes the whole screen and opens **fitted
  to the text**: the words fill the width and the printed margins stay off screen, so the same
  page reads around 40 % larger. archivist finds the column from the text of a few pages
  spread over the book, keeping the headings and labels that hang in the margin and leaving out
  running heads and page numbers; it is remembered per book. "Ajustar al texto" is in the zoom
  menu on a computer too. A scanned book, with no text to measure, fits its page's width.
- The bars lie over the page and get out of the way: they go when you push the page up to read on,
  and one tap brings them back (the first time, a line says so). Two taps go between the text and
  the whole page; two fingers zoom as before; with pages one at a time, a tap on a side or a swipe
  turns the page. Pressing and holding still selects text.
- Under the page, a bar for the thumb: the index, a slider through the whole book and the page
  number to type. On top, only what is used while reading: back, the title, fit to the text,
  search, the menu and the panel to ask.
- The index and the page thumbnails are a drawer with rows a finger can hit, and it closes when you
  pick a place. The menu is a sheet from below, with the size on top. Search takes the top of the
  screen, and matches are not hidden under it.
- The panel to ask is a sheet over the lower half, text at reading size, and it takes the whole
  screen for the answer (a button puts it back). It no longer brings the keyboard up when it
  opens, and while you type the viewer is the part of the screen the keyboard leaves free. The
  question still goes with the page that was in view.
- Everywhere on a phone: fields no longer make the browser zoom in when focused (their text is
  16px), buttons in the readers are 44px to the finger, the page slider has a strip to grab
  instead of a 4px line, and the bars keep clear of the home indicator.
- A book in one PDF shows "Página 175 de 548" on its page instead of "0 de 1 leídos", and no list
  of its one volume; the button reads "Leer" or "Seguir".
- Fixed: on an iPhone a pinch zoomed twice as much as the fingers asked (Safari reports it as a
  gesture and as touches); the index of a PDF could change the zoom on every entry; the colours
  of a profile were drawn at the size of the paper swatches in the book menu; the chips on a
  work's page were pushed 8px in; "Modo presentación" was offered where there is no full screen
  (an iPhone), with no way back; the pinch was measured from the wrong corner by the height of the
  bar.

## 0.9.0 — 2026-11-26

- Books open in a PDF viewer like a browser's own (pdf.js, the engine of Firefox's): the real
  pages, sharp at any zoom; zoom with Ctrl/⌘ and the wheel, a trackpad pinch or two fingers, or
  the menu (automatic, fit the page, fit the width, actual size, 50 to 400 %); text that can be
  selected and searched (Ctrl/⌘ F, every match marked); the book's own index and page thumbnails
  on the left; scrolling vertical, page by page, horizontal or as a mosaic; one page, two, or two
  with the cover alone; four paper colours (original, sepia, dark, night); rotation, full screen,
  a presentation mode, and the PDF to download. It is remembered per book, in that browser. The
  page in view is saved as before. Manga, comics and `?classic=1` keep the page reader.
- The panel to ask is docked on the right of the book, and its edge can be dragged wider. Select
  words on the page and "Preguntar sobre esto" asks about that passage.
- Answers that teach: the model is asked for the answer first with the key idea in bold, then
  short points or numbered steps, one or two learning aids that fit (an example, an analogy, a
  table, a common mistake, a diagram, a chart, a formula), and a closing "Para recordar". The
  panel renders them: Markdown with lists, tables and headings; code with its language and a copy
  button; Mermaid diagrams, ```` ```chart ```` blocks drawn as SVG, and LaTeX math with KaTeX, each
  loaded only when an answer has one, all under the same CSP. "Respuestas" folds away until asked.
- Study shortcuts under the box: explain it simply, summary in points, an example, an analogy, a
  diagram, key terms, and "Poneme a prueba" (three questions, answers hidden). Each answer can be
  copied. A selected passage goes with the question, quoted.
- Up to 4000 tokens per answer (a reasoning model's thinking counts against it) and 120 s to
  answer, so a reasoning model like `deepseek/deepseek-v4-pro` fits.

## 0.8.0 — 2026-11-26

- Books: `type: book` is a work of its own (a PDF per volume under `pages/`), read left to right,
  with its own row at home, its own filter and its own OPDS shelf. "Subir" creates one.
- The words of a PDF page: `GET /api/v1/units/…/pages/:n/text`, and `get_page_text` over MCP, so an
  agent that knows where you are (`get_progress`) can read the page you are on.
- Ask about the page: with `ARCHIVIST_ASSISTANT_KEY` set, the reader of a PDF gets a panel beside
  the page (a sheet from below on a phone) to ask a model about what is on screen. The server
  sends the question, the work's title and the words of that page and the two before it, never a
  page further on; the key never reaches the browser. Any API that speaks chat completions:
  DeepSeek by default, OpenRouter or Ollama with `ARCHIVIST_ASSISTANT_URL` and
  `ARCHIVIST_ASSISTANT_MODEL`. `POST /api/v1/units/…/ask`. Off by default; SOUL.md says what
  leaves the server when it is on.

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
