import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Unified vitest config using vitest-pool-workers.
 *
 * All tests run in the Cloudflare Workers runtime (workerd) which enables:
 * - Testing with cloudflare:test bindings (KV, AI, etc.)
 * - Using fetchMock from cloudflare:test for HTTP mocking
 *
 * Bindings (KV, vars, compatibility flags) are defined in wrangler.test.jsonc
 * to keep test config aligned with production wrangler.jsonc.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/server/index.ts",
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
  /**
   * Workaround for ajv CJS compatibility in workerd runtime.
   *
   * The MCP SDK imports ajv at module level (even when using CfWorkerJsonSchemaValidator).
   * ajv uses CJS require() for JSON files which fails in workerd.
   * See: https://github.com/cloudflare/workers-sdk/issues/9822
   *
   * This is TEST-ONLY - production uses CfWorkerJsonSchemaValidator which
   * doesn't actually invoke ajv, but the import still triggers the CJS issue.
   */
  resolve: {
    alias: {
      ajv: path.resolve(__dirname, "src/test-utils/ajv-stub.ts"),
      "ajv-formats": path.resolve(__dirname, "src/test-utils/ajv-stub.ts"),
    },
  },
  // Force bundling to apply the ajv alias during module resolution
  ssr: {
    noExternal: ["@modelcontextprotocol/sdk", "agents", "zod-to-json-schema"],
  },
});
