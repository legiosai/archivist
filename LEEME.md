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

</div>

> **Estado: 0.1.** Lee, reproduce, recuerda y recibe subidas. Un solo dueño,
> interfaz en castellano. Lo que sigue está en el [plan](docs/plan.md).

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
- **Una API** con token, para que una herramienta liste obras, pida una página
  o un fotograma y sepa dónde quedaste.

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
herramientas reciben páginas y fotogramas, nunca clips.

## Desarrollo

```sh
npm install
npm test
npm run typecheck
npm run dev            # la interfaz con recarga, contra un servidor en :8780
```
