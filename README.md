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

<img src="docs/img/library.jpg" alt="The library: a continue shelf and every work, read or watched" width="640">

</div>

> **Status: 0.6.** It reads, plays, remembers and takes uploads, with a profile for each person,
> posters and details from TMDB or AniList if you turn them on, a year in review, OPDS for phones
> and an API and MCP server for tools. Spanish UI first.
> [The plan](docs/plan.md) is complete; what changed is in the [changelog](CHANGELOG.md).

## What it is

A self-hosted library for what you already have on disk:

- **A reader** for manga and comics (CBZ, ZIP, PDF, folders of images):
  right-to-left, left-to-right, vertical and double-page. It remembers the
  volume, the chapter and the page.
- **A player** for films, series and anime: what the browser plays directly,
  the rest remuxed on the fly with ffmpeg, subtitles included (beside the file or
  inside it). Pick the audio track and the subtitles; each profile's choice carries
  to the next episode. It remembers the episode and the second.
- **Posters and details**: a `poster.jpg` in the work's folder, a frame you pick,
  or, if you turn it on, the poster, synopsis, genres and credits from TMDB (films
  and series) or AniList (anime and manga).
- **One library**: the same story as a manga and as an anime is one work, with
  one place to continue.
- **Profiles** for everyone in the house, picked at the door like on a streaming
  service: each with its own avatar, its own "continue", its own phone catalog and
  its own year in review (time watched, pages read, what they finished).
- **An API** with a token, so a tool can list works, ask for a page or a frame,
  and read where you are. An MCP server for agents, too.

<img src="docs/img/reader.jpg" alt="The reader, two pages right to left" width="640">

## What it is not

It never fetches works: no downloader, no scraper, no source list. It reads the
files you put in its folders. See [SOUL.md](SOUL.md) for the rules it keeps.

## The library on disk

```
library/
  video/<work>.mp4 + <work>.yaml          a film (its poster: <work>-poster.jpg)
  video/<work>/S01E01.mkv … + work.yaml    a series or an anime (poster.jpg in the folder)
  pages/<work>/vol-01.cbz … + work.yaml    a manga or a comic (poster.jpg in the folder)
```

The yaml can also say what the work is about, and that always wins over a lookup:
`overview`, `genres`, and `director`, `author` or `studio`.

The folders are the truth: copy them with rsync, back them up without archivist
running. The database only holds what a disk cannot — where you are.

## Install

**Docker**

```sh
docker build -t archivist https://github.com/legiosai/archivist.git
docker run -d --name archivist -p 8780:8780 \
  -v /path/to/library:/library -v archivist-data:/data \
  -e ARCHIVIST_TOKEN="$(openssl rand -hex 24)" archivist
```

**From source** (Node 22 or newer, plus `ffmpeg` and `poppler-utils`)

```sh
git clone https://github.com/legiosai/archivist && cd archivist
npm ci && npm run build
ARCHIVIST_LIBRARY=/path/to/library ARCHIVIST_TOKEN=… npm start
```

A systemd user unit and an example environment file are in [`deploy/`](deploy/).

| Variable | Default | |
|---|---|---|
| `ARCHIVIST_LIBRARY` | — | The folder with `video/`, `pages/` and `stills/`. |
| `ARCHIVIST_DATA` | `./data` | The database (progress) and the caches. |
| `ARCHIVIST_HOST` | `127.0.0.1` | Any other address requires a token. |
| `ARCHIVIST_PORT` | `8780` | |
| `ARCHIVIST_TOKEN` | — | For the API (`Authorization: Bearer`) and the browser login. |
| `ARCHIVIST_BACKUP_DIR` | — | A daily copy of the database (progress), the newest 14 kept. |
| `ARCHIVIST_OWNER_NAME` | `Yo` | The first profile's name. More profiles are added in the UI. |
| `ARCHIVIST_TRUSTED` | — | Networks that need no token: `loopback`, `tailscale`, `lan`, or CIDRs (`192.168.1.0/24`). Judged by the connection's address, never by headers, and never for a request that came through a reverse proxy. |
| `ARCHIVIST_HOSTS` | — | More host names that reach it from a trusted network (beyond addresses, `localhost`, one-word names and `.ts.net`/`.local`/`.lan`). Anything else needs the token, which stops DNS rebinding. |
| `ARCHIVIST_PROXIES` | `loopback` | Reverse proxies whose `CF-Connecting-IP` / `X-Forwarded-For` is believed for the client's address. In Docker, the proxy's network (`172.17.0.0/16`). Any request with those headers is untrusted either way. |
| `ARCHIVIST_PROXIED_VIDEO` | off | Serve video to requests that came through the public proxy. Off by default: at home, video goes over the LAN or Tailscale. |
| `ARCHIVIST_METADATA` | — | Where to look works up: `tmdb`, `anilist`, or both. Off by default: then nothing leaves the server. When on, the server (never the browser) sends a work's title and year once, and keeps what comes back. |
| `ARCHIVIST_TMDB_TOKEN` | — | TMDB's API read access token (or a v3 API key), free at themoviedb.org. AniList needs none. |

## API

Everything the UI does goes through [the API](docs/api.md): works, units, pages, single frames,
progress, events and resumable uploads. Tools get pages and frames, never clips. It is
described in OpenAPI 3.1 at `/api/v1/openapi.json`.

## For agents

archivist is an MCP server at `/mcp` (Streamable HTTP, the same token). An agent can search the
library, open a work, look at a page or a frame, and read or save where someone is:

```sh
claude mcp add --transport http archivist https://your-server/mcp --header "Authorization: Bearer $ARCHIVIST_TOKEN"
```

Tools: `search_library`, `list_works`, `get_work`, `get_progress`, `set_progress`, `get_page`,
`get_frame`, `recent_events`, `list_profiles`. `/llms.txt` sums it up for a model.

## On the internet

Put it behind a reverse proxy that terminates TLS (a Cloudflare Tunnel, Caddy, nginx). archivist
notices a proxied request (it carries `CF-Connecting-IP`, `X-Forwarded-For` or `Forwarded`; the
client's address is read from a proxy listed in `ARCHIVIST_PROXIES`, loopback by default) and
then: never treats it as a trusted network, logs
each wrong token with the real client address (`archivist: auth failure from <ip>`, for
fail2ban or CrowdSec), answers 429 after 10 wrong tokens in 15 minutes, marks the session cookie
`Secure`, sends HSTS, and keeps video at home unless `ARCHIVIST_PROXIED_VIDEO=on`. Reading,
progress and the API work as at home. See [SECURITY.md](SECURITY.md).

## Installed on the phone

The page has a web manifest and icons: "Add to home screen" puts archivist there. To open it as
its own app, without the browser's bar, browsers ask for HTTPS; on Tailscale, `tailscale serve`
gives the machine an `https://<name>.<tailnet>.ts.net` address.

## On the phone

`http://your-server:8780/opds` is an OPDS catalog: add it to Panels, Chunky, KOReader or Mihon.
Volumes stream page by page, and reading there moves the same "continue" shelf. For someone
else's profile, `…/opds?profile=sol`.

## Metadata

When `ARCHIVIST_METADATA` is on, posters, synopses, genres and credits come from
[TMDB](https://www.themoviedb.org) and [AniList](https://anilist.co). This product uses the TMDB
API but is not endorsed or certified by TMDB.

## Develop

```sh
npm install
npm test
npm run typecheck
npm run dev            # the UI with hot reload, against a server on :8780
```
