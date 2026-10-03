/** `node src/main.ts`: the server, with the settings from the environment (src/config.ts). */
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";

const cfg = loadConfig();
mkdirSync(cfg.data, { recursive: true });
const app = createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  console.log(`archivist on http://${cfg.host}:${cfg.port} — ${app.library.works.size} work(s) in ${cfg.library}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { void app.close().then(() => process.exit(0)); });
}
