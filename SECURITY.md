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

An HTTP server meant for your own network (a Tailscale address, say), and safe
to publish behind a reverse proxy on the same machine.

- **Token.** The API, OPDS and MCP ask for `ARCHIVIST_TOKEN`, except from the
  networks you list in `ARCHIVIST_TRUSTED` (`tailscale`, `lan`, CIDRs). That is
  decided by the connection's own address, never by a header.
- **Behind a proxy.** A request carrying `CF-Connecting-IP`, `X-Forwarded-For`
  or `Forwarded` came through a proxy (or pretends to): it is never on a trusted
  network, even with `loopback` or `lan` in the list. Its client is the address
  in that header only when the connection comes from a proxy listed in
  `ARCHIVIST_PROXIES` (loopback by default; the proxy's network in Docker).
- **DNS rebinding.** A trusted network only counts under a host name someone at
  home would use (an address, `localhost`, a one-word name, `.ts.net`,
  `.local`, `.lan`, or `ARCHIVIST_HOSTS`); otherwise the token is required.
- **Browser sessions.** Logging in trades the token for a random session id in
  an HttpOnly, SameSite=Strict cookie (`Secure` over HTTPS). The database keeps
  only its hash. Sessions last 90 days from their last use, and Perfiles lists
  them and ends them all at once. Cross-site writes are refused.
- **Guessing.** Every wrong token is logged with the client's real address
  (`archivist: auth failure from <ip> on <path> (<n>)`), and after 10 in 15
  minutes that address gets 429 until the window ends. Feed the log to fail2ban
  or CrowdSec to ban at the edge.
- **Headers.** Content-Security-Policy (`default-src 'self'`, no frames),
  `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, and HSTS over HTTPS.
- **Video stays home.** Through the proxy, video and its conversion are off
  unless `ARCHIVIST_PROXIED_VIDEO=on`; pages, frames, progress and the API are
  not.

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
ejemplo), que se puede publicar detrás de un proxy inverso en la misma máquina.

- **Token.** La API, OPDS y MCP piden `ARCHIVIST_TOKEN`, salvo desde las redes
  de `ARCHIVIST_TRUSTED` (`tailscale`, `lan`, CIDRs). Lo decide la dirección de
  la conexión, nunca un header.
- **Detrás de un proxy.** Una solicitud con `CF-Connecting-IP`,
  `X-Forwarded-For` o `Forwarded` pasó por un proxy (o lo finge): nunca cuenta
  como red de confianza, aunque `loopback` o `lan` estén en la lista. Su cliente
  es la IP de ese header solo si la conexión viene de un proxy de
  `ARCHIVIST_PROXIES` (loopback por defecto; la red del proxy en Docker).
- **DNS rebinding.** Una red de confianza solo cuenta con un nombre de host que
  usaría alguien de la casa (una IP, `localhost`, un nombre de una palabra,
  `.ts.net`, `.local`, `.lan` o `ARCHIVIST_HOSTS`); si no, pide el token.
- **Sesiones del navegador.** Al entrar, el token se cambia por un id de sesión
  al azar en una cookie HttpOnly y SameSite=Strict (`Secure` con HTTPS). La base
  guarda solo su hash. Duran 90 días desde el último uso, y en Perfiles se ven y
  se cierran todas juntas. Las escrituras desde otro sitio se rechazan.
- **Adivinar.** Cada token equivocado queda registrado con la IP real
  (`archivist: auth failure from <ip> on <path> (<n>)`), y después de 10 en 15
  minutos esa IP recibe 429 hasta que termina la ventana. Ese registro sirve
  para que fail2ban o CrowdSec bloqueen en el borde.
- **Headers.** Content-Security-Policy (`default-src 'self'`, sin frames),
  `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, y HSTS con HTTPS.
- **El video queda en casa.** Por el proxy, el video y su conversión están
  apagados salvo con `ARCHIVIST_PROXIED_VIDEO=on`; las páginas, los fotogramas,
  el progreso y la API no.

## Reportes

Un [security advisory](https://github.com/legiosai/archivist/security/advisories/new)
o un mail a valentintorassacolombero@gmail.com. Un issue público no, si toca
una vulnerabilidad.
