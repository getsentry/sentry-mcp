import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

/**
 * Unified vitest config using vitest-pool-workers.
 *
 * All tests run in the Cloudflare Workers runtime (workerd) which enables:
 * - Testing with cloudflare:test bindings (KV, AI, etc.)
 * - Using fetchMock from cloudflare:test for HTTP mocking
 *
 * This replaces the previous two-config approach:
 * - Old: vitest.config.ts (MSW/Node.js) + vitest.workers.config.ts (workerd)
 * - New: Single config using workerd for all tests
 */
export default defineWorkersConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Exclude tests that require Node.js-specific module handling (CJS deps like ajv)
    exclude: ["src/server/lib/mcp-handler.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          kvNamespaces: ["OAUTH_KV"],
        },
      },
    },
  },
});
