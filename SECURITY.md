# Security

archivist serves files from your disk over HTTP, so here is what it touches and
what it exposes.

*(En español, más abajo: [Seguridad](#seguridad).)*

## What it reads and writes

- **Reads** the files under its library folder, and nothing outside it: every
  path a request names is resolved and checked against the library root.
- **Writes** its database (progress and a metadata cache), a cache of rendered
  pages and frames, and the files you upload, all under its data folder.

## What leaves your machine

Only metadata lookups (titles, years, covers) to TMDB and AniList, and only
when you configure them. Never your files, never your progress.

## What it exposes

An HTTP server meant for your own network (a Tailscale address, say). The API
asks for a token, except from the networks you list in `ARCHIVIST_TRUSTED`
(`tailscale`, `lan`, CIDRs). That is decided by the connection's own address,
never by `X-Forwarded-For`: behind a reverse proxy every request comes from the
proxy, so do not trust the proxy's network. Do not put it on the open internet
without a reverse proxy you trust.

## Reporting

Open a [security advisory](https://github.com/legiosai/archivist/security/advisories/new),
or email valentintorassacolombero@gmail.com. Please don't open a public issue
for a vulnerability.

---

# Seguridad

archivist sirve archivos de tu disco por HTTP. Esto es lo que toca y lo que
expone.

## Qué lee y qué escribe

- **Lee** los archivos de su carpeta de biblioteca y nada fuera de ella: cada
  ruta que pide una solicitud se resuelve y se compara con la raíz.
- **Escribe** su base (progreso y un caché de metadatos), un caché de páginas y
  fotogramas, y los archivos que subís, todo dentro de su carpeta de datos.

## Qué sale de tu máquina

Solo consultas de metadatos (títulos, años, portadas) a TMDB y AniList, y solo
si las configurás. Nunca tus archivos ni tu progreso.

## Qué expone

Un servidor HTTP pensado para tu propia red (una dirección de Tailscale, por
ejemplo). La API pide token, salvo desde las redes que pongas en
`ARCHIVIST_TRUSTED` (`tailscale`, `lan`, CIDRs). Eso se decide por la dirección
de la conexión, nunca por `X-Forwarded-For`: detrás de un proxy inverso todo
llega desde el proxy, así que no confíes en su red. No lo pongas en internet
abierta sin un proxy inverso de confianza.

## Reportes

Un [security advisory](https://github.com/legiosai/archivist/security/advisories/new)
o un mail a valentintorassacolombero@gmail.com. Un issue público no, si toca
una vulnerabilidad.
