/** `archivist scan <library>`: what the scanner sees, as JSON. The server comes in phase 2. */
import { scan } from "./library/scan.ts";

const [command, root] = process.argv.slice(2);
if (command !== "scan" || !root) {
  console.error("usage: archivist scan <library-folder>");
  process.exit(2);
}
let works;
try {
  works = scan(root);
} catch (err) {
  console.error(`archivist: cannot read ${root}: ${(err as NodeJS.ErrnoException).code ?? err}`);
  process.exit(1);
}
console.log(JSON.stringify(works, null, 2));
console.error(`${works.length} work(s), ${works.reduce((n, w) => n + w.units.length, 0)} unit(s)`);
