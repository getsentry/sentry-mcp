/// <reference types="vitest" />
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        miniflare: {},
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["**/*.ts"],
    },
    // MSW doesn't work in Workers pool - mock fetch directly in tests with vi.fn()
  },
});
