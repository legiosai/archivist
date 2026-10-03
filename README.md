<div align="center">

# archivist

**Everything you own to read or watch, in one place — and it never forgets where you stopped.**
Manga, comics, films, series and anime, served from your own disk, with one
"continue" shelf for all of them and an API for your tools.

[Plan](docs/plan.md) ·
[Security](SECURITY.md) ·
[En castellano](LEEME.md) ·
MIT

<sub>An instrument by</sub><br>
<a href="https://github.com/legiosai"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/legios.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/legios-claro.svg">
  <img alt="Legios" src="docs/legios-claro.svg" width="132" height="43">
</picture></a>

</div>

> **Status: early.** Phase 1 of [the plan](docs/plan.md): the library scanner.
> The reader, the player and the API come next. Nothing here is released yet.

## What it is

A self-hosted library for what you already have on disk:

- **A reader** for manga and comics (CBZ, ZIP, PDF, folders of images):
  right-to-left, left-to-right, vertical and double-page. It remembers the
  volume, the chapter and the page.
- **A player** for films, series and anime: what the browser plays directly,
  the rest remuxed on the fly with ffmpeg, subtitles included. It remembers the
  episode and the second.
- **One library**: the same story as a manga and as an anime is one work, with
  one place to continue.
- **An API** with a token, so a tool can list works, ask for a page or a frame,
  and read where you are.

## What it is not

It never fetches works: no downloader, no scraper, no source list. It reads the
files you put in its folders. See [SOUL.md](SOUL.md) for the rules it keeps.

## The library on disk

```
library/
  video/<work>.mp4 + <work>.yaml          a film
  video/<work>/S01E01.mkv … + work.yaml    a series or an anime
  pages/<work>/vol-01.cbz … + work.yaml    a manga or a comic
```

The folders are the truth: copy them with rsync, back them up without archivist
running. The database only holds what a disk cannot — where you are.

## Develop

```sh
npm install
npm test
npm run typecheck
```

Node 22 or newer.
