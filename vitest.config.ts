import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The real `obsidian` package is types-only; tests that import src/main.ts
      // need a runtime stand-in. tsc still typechecks src/ against the real
      // typings — this alias applies to vitest only.
      obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
