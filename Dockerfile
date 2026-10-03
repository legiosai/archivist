# archivist: the server plus ffmpeg and poppler. Mount your library at /library (read-write if you
# want uploads) and a folder for the database and caches at /data; set ARCHIVIST_TOKEN.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
RUN mkdir -p /library /data && chown node:node /library /data
ENV ARCHIVIST_LIBRARY=/library ARCHIVIST_DATA=/data ARCHIVIST_HOST=0.0.0.0 ARCHIVIST_PORT=8780 NODE_ENV=production
EXPOSE 8780
VOLUME ["/library", "/data"]
USER node
CMD ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "src/main.ts"]
