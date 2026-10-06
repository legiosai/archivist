<div align="center">

# archivist

**Todo lo que tenés para leer o mirar, en un solo lugar, y nunca se olvida dónde quedaste.**
Manga, cómics, películas, series y anime, servidos desde tu propio disco, con
un solo estante de «seguir» para todo y una API para tus herramientas.

[Plan](docs/plan.md) ·
[Seguridad](SECURITY.md#seguridad) ·
[In English](README.md) ·
MIT

<sub>Un instrumento de</sub><br>
<a href="https://github.com/legiosai"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/legios.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/legios-claro.svg">
  <img alt="Legios" src="docs/legios-claro.svg" width="132" height="43">
</picture></a>

<img src="docs/img/library.jpg" alt="La biblioteca: el estante de seguir y todas las obras" width="640">

</div>

> **Estado: 0.6.** Lee, reproduce, recuerda y recibe subidas, con un perfil para cada
> persona, portadas y datos de TMDB o AniList si los activás, un resumen del año, OPDS para el
> celular y una API y un servidor MCP para herramientas. Interfaz en castellano. El [plan](docs/plan.md) está completo; los cambios están en el
> [changelog](CHANGELOG.md).

## Qué es

Una biblioteca auto-alojada de lo que ya tenés en disco:

- **Un lector** de manga y cómics (CBZ, ZIP, PDF, carpetas de imágenes): de
  derecha a izquierda, de izquierda a derecha, vertical y a doble página.
  Recuerda el tomo, el capítulo y la página.
- **Un reproductor** de películas, series y anime: lo que el navegador
  reproduce directo, y el resto remuxado al vuelo con ffmpeg, con subtítulos.
  Recuerda el episodio y el minuto.
- **Una sola biblioteca**: la misma historia en manga y en anime es una obra,
  con un solo lugar para seguir.
- **Perfiles** para cada persona de la casa, elegidos al entrar como en un
  servicio de streaming: cada uno con su avatar, su «seguir» y su catálogo para
  el celular.
- **Una API** con token, para que una herramienta liste obras, pida una página
  o un fotograma y sepa dónde quedaste. Y un servidor MCP para agentes.

<img src="docs/img/reader.jpg" alt="El lector, dos páginas de derecha a izquierda" width="640">

## Qué no es

Nunca trae obras: ni descargas, ni scraping, ni listas de fuentes. Lee los
archivos que ponés en sus carpetas. Las reglas que cumple están en
[SOUL.md](SOUL.md).

## La biblioteca en disco

```
library/
  video/<obra>.mp4 + <obra>.yaml           una película
  video/<obra>/S01E01.mkv … + work.yaml     una serie o un anime
  pages/<obra>/tomo-01.cbz … + work.yaml    un manga o un cómic
```

Las carpetas mandan: se copian con rsync y se respaldan sin que archivist esté
corriendo. La base solo guarda lo que un disco no puede: dónde quedaste.

## Instalar

**Docker**

```sh
docker build -t archivist https://github.com/legiosai/archivist.git
docker run -d --name archivist -p 8780:8780 \
  -v /ruta/a/la/biblioteca:/library -v archivist-data:/data \
  -e ARCHIVIST_TOKEN="$(openssl rand -hex 24)" archivist
```

**Desde el código** (Node 22 o más nuevo, más `ffmpeg` y `poppler-utils`)

```sh
git clone https://github.com/legiosai/archivist && cd archivist
npm ci && npm run build
ARCHIVIST_LIBRARY=/ruta/a/la/biblioteca ARCHIVIST_TOKEN=… npm start
```

En [`deploy/`](deploy/) hay una unidad de systemd de usuario y un archivo de
entorno de ejemplo. Las variables están en el [README](README.md#install).

## API

Todo lo que hace la interfaz pasa por [la API](docs/api.md): obras, unidades,
páginas, fotogramas sueltos, progreso, eventos y subidas que se retoman. Las
herramientas reciben páginas y fotogramas, nunca clips. Está descrita en OpenAPI
3.1 en `/api/v1/openapi.json`.

## Para agentes

archivist es un servidor MCP en `/mcp` (HTTP con streaming, el mismo token). Un
agente puede buscar en la biblioteca, abrir una obra, mirar una página o un
fotograma, y leer o guardar dónde va cada uno:

```sh
claude mcp add --transport http archivist https://tu-servidor/mcp --header "Authorization: Bearer $ARCHIVIST_TOKEN"
```

Herramientas: `search_library`, `list_works`, `get_work`, `get_progress`,
`set_progress`, `get_page`, `get_frame`, `recent_events`, `list_profiles`.
`/llms.txt` lo resume para un modelo.

## En internet

Ponelo detrás de un proxy inverso con TLS (un Cloudflare Tunnel, Caddy, nginx).
archivist reconoce una solicitud que pasó por el proxy (trae `CF-Connecting-IP`,
`X-Forwarded-For` o `Forwarded`; la IP del cliente se lee solo si viene de un
proxy de `ARCHIVIST_PROXIES`, loopback por defecto, como en Docker con
`172.17.0.0/16`) y entonces: nunca la
trata como red de confianza, registra cada token equivocado con la IP real
(`archivist: auth failure from <ip>`, para fail2ban o CrowdSec), responde 429
después de 10 intentos fallidos en 15 minutos, marca la cookie de sesión como
`Secure`, manda HSTS y deja el video en casa salvo con
`ARCHIVIST_PROXIED_VIDEO=on`. Leer, el progreso y la API funcionan igual que en
casa. Más en [SECURITY.md](SECURITY.md).

## En el celular

`http://tu-servidor:8780/opds` es un catálogo OPDS: agregalo en Panels, Chunky,
KOReader o Mihon. Los tomos se leen página por página, y lo que leés ahí mueve el
mismo estante de «seguir». Para el perfil de otra persona, `…/opds?profile=sol`.

## Desarrollo

```sh
npm install
npm test
npm run typecheck
npm run dev            # la interfaz con recarga, contra un servidor en :8780
```
