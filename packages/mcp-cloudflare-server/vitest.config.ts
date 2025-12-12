/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// Unit tests - use standard vitest pool for mocked tests
export default defineConfig({
  test: {
    name: "unit",
    pool: "threads",
    deps: {
      interopDefault: true,
    },
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["**/*.ts"],
    },
    setupFiles: ["dotenv/config", "src/test-setup.ts"],
  },
});
