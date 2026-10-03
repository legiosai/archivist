import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is the UI: the tests live in test/.
export default defineConfig({
  test: { root: ".", include: ["test/**/*.test.ts"], environment: "node" },
});
