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
