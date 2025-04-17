/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    poolOptions: {
      workers: {
        miniflare: {},
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
    deps: {
      interopDefault: true,
    },
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["**/*.ts"],
    },
    setupFiles: ["dotenv/config"],
  },
});
