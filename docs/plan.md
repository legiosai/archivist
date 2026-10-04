# Plan — archivist

Escrito el 2026-10-03, cuando se decidió el proyecto. Las decisiones con fecha
no se reescriben: si cambian, se agrega la nueva debajo.

## Qué es

Una biblioteca auto-alojada de lo que tenés para leer y para mirar: manga,
cómics, películas, series y anime. Lee y reproduce, recuerda tomo, capítulo,
página, episodio y minuto, y expone una API con token para que otras
herramientas la usen. La primera es VT-Showrunner, que hace videos de la
historia completa de lo que su dueño leyó o miró.

Hay proyectos maduros que hacen la mitad: Kavita y Komga leen, Jellyfin
reproduce. Lo que agrega archivist es juntar las dos formas de una misma obra
con un solo progreso, la API pensada para herramientas, y la interfaz en
castellano. De ellos se toman ideas y estándares (OPDS, la estructura de
carpetas), no código.

## Decisiones (2026-10-03)

- Nombre: **archivist**, un oficio como quartermaster, cartographer y healer.
- Repo público `legiosai/archivist`, licencia MIT, README en inglés y LEEME en
  castellano, como quartermaster.
- Node ≥ 22 y TypeScript. SQLite con `node:sqlite` (sin dependencias nativas).
  La interfaz en React con Vite, como `legiosai/app`. Tests con vitest.
- Pocas dependencias: el ZIP de un CBZ se lee con el índice central y `zlib`
  de Node, sin descomprimirlo entero; las páginas de un PDF y los fotogramas
  salen de `pdftoppm` y `ffmpeg`, que ya están en el servidor.
- Se despliega en valensrv como servicio systemd de usuario, solo en Tailscale,
  con la biblioteca en `/srv`. El backup copia la base (progreso y metadatos),
  no los archivos.

## La estructura en disco

La misma que ya usa la entrada de VT-Showrunner, así hay una sola copia de cada
archivo y Showrunner la lee igual:

```
library/
  video/<obra>.mp4 + <obra>.yaml          una película
  video/<obra>/S01E01.mkv … + work.yaml    una serie o un anime
  pages/<obra>/tomo-01.cbz … + work.yaml   un manga o un cómic (CBZ, ZIP, PDF o carpetas de imágenes)
  stills/<obra>/… + work.yaml              capturas
```

`work.yaml`: `title`, `type` (film, series, anime, manga, comic), `year`,
`original_title`, `ids` (tmdb_movie, tmdb_tv, anilist, wikidata) y, para
páginas, `reading: rtl | ltr`.

## Fases

1. **Base.** Repo, documentos, estructura del proyecto, CI, y el escáner de la
   biblioteca: carpetas → obras → unidades (tomos, capítulos, episodios).
2. **Lector y progreso.** Páginas de CBZ, ZIP, PDF y carpetas; lectura de
   derecha a izquierda, de izquierda a derecha, vertical (webtoon) y doble
   página; precarga; teclado y gestos. Guarda tomo, capítulo y página, y arma
   el estante «Seguir leyendo».
3. **Reproductor.** Directo lo que el navegador soporta; MKV o HEVC remuxado o
   transcodificado al vuelo con ffmpeg; subtítulos .srt y .ass a WebVTT; guarda
   el minuto y ofrece el episodio siguiente.
4. **Subidas y despliegue.** Subidas que se retoman (tus) para archivos de
   varios GB y carpetas; vigilancia de carpetas para lo que llega por rsync;
   servicio en valensrv.
5. **Showrunner.** La Biblioteca de Showrunner lee de la API (obras, unidades,
   páginas, fotogramas, progreso), y el piloto prioriza lo que el dueño terminó
   de leer o mirar.
6. **Para otros.** Imagen Docker, capturas, landing en
   `archivist.legios.com.ar`, primera versión publicada.

## La API (primer borrador)

```
GET  /api/v1/works                         obras, con tipo, forma y progreso
GET  /api/v1/works/:id                     una obra y sus unidades
GET  /api/v1/units/:id/pages/:n            una página (imagen)
GET  /api/v1/units/:id/frame?t=SECONDS     un fotograma (imagen)
GET  /api/v1/progress                      dónde quedó el dueño en cada obra
PUT  /api/v1/progress/:unit                guardar la posición
GET  /api/v1/events?since=…                terminó una unidad, llegó una obra
```

Con token (`Authorization: Bearer …`). La interfaz usa la misma API.

## Estado (2026-10-03, noche)

Fases 1 a 5 hechas el mismo día, y la 6 salvo la landing:

- **0.1.0 publicada** (tag `v0.1.0`). Escáner, lector (derecha a izquierda, izquierda a
  derecha, vertical, doble página), reproductor (directo o preparado una vez con ffmpeg y
  NVENC), progreso y estante «Seguir», subidas que se retoman, API con token, imagen Docker
  probada, unidad de systemd, capturas en el README.
- **En valensrv**: servicio de usuario `archivist` en `100.66.32.75:8780`, Node 24 de nvm, la
  biblioteca es la carpeta de entrada de VT-Showrunner (`~/apps/VT-Showrunner/data/inbox`),
  la base en `~/.local/share/archivist`, copias diarias en `~/backups/archivist` (14).
  El token vive en `~/.config/archivist/env` (600) y en el `.env` de Showrunner.
- **Showrunner lo usa**: su Biblioteca muestra cuánto leíste o miraste de cada obra con un
  enlace para abrirla, y el piloto pone primero lo que terminaste hace poco.

Pendiente (al cierre de la 0.1): la landing, varios usuarios, OPDS, y que Showrunner pida las
páginas y los fotogramas por la API cuando no comparta disco con archivist.

## Estado (2026-10-03, 0.2.0)

- **Landing** en https://archivist.legios.com.ar (y `/es/`): GitHub Pages desde `docs/`,
  CNAME `archivist` → `legiosai.github.io` en Cloudflare, sin proxy, certificado de GitHub y
  HTTPS forzado.
- **Red de confianza**: `ARCHIVIST_TRUSTED`. En valensrv escucha en todas las interfaces y no
  pide token desde Tailscale ni desde la LAN de casa (192.168.100.0/24); las redes de Docker
  del servidor y cualquier otra sí lo piden.
- **OPDS** en `/opds` para leer desde el celular (Panels, Chunky, KOReader, Mihon), con PSE
  que guarda la página, y Basic auth con el token como contraseña.

Sigue: varios usuarios (cada uno con su progreso), mover la biblioteca a `/srv` en valensrv
(pide sudo una vez), y la API de páginas para Showrunner cuando no compartan disco.

## Estado (2026-10-03, 0.3.0)

- **Perfiles**: cada persona de la casa tiene su propio lugar en cada obra; «¿Quién lee?»
  cuando hay más de uno; en OPDS, el usuario elige el perfil. La base de la 0.2 se migró: su
  progreso pasó al dueño (copia previa en `~/backups/archivist/archivist-pre-0.3.0.db`).

Sigue: la API de páginas para Showrunner cuando no compartan disco.

## 2026-10-04: la biblioteca en `/srv`

Los datos de VT-Showrunner, y con ellos la biblioteca de archivist, pasaron del disco del
sistema a `/srv/vt-showrunner/data` (el SSD de 960 GB, 540 GB libres). Copia con rsync y una
segunda pasada con checksums sin diferencias. `~/apps/VT-Showrunner/data` es ahora un enlace a
esa carpeta, `SHOWRUNNER_DATA` y `ARCHIVIST_LIBRARY` apuntan ahí, y la copia vieja quedó en
`~/apps/VT-Showrunner/data.moved-20261004` hasta confirmar que no hace falta.

## 2026-10-04: Showrunner por la API

Si Showrunner corre en otra máquina que archivist, ya no hace falta compartir disco: las obras
que solo tiene archivist aparecen en su Biblioteca, y cuando un video necesita una, Showrunner
baja por la API las páginas de los tomos que cubre, o fotogramas sueltos de la película o de los
episodios, repartidos a lo largo de la duración (nunca clips). Probado contra el archivist de
valensrv desde otra máquina de la LAN. En valensrv siguen compartiendo disco y ese camino no se
usa. Con esto el plan quedó completo.
