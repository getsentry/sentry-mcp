/// <reference types="vitest" />
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Integration tests - run in actual Workers runtime using pre-built worker
//
// Why pre-build?
// The MCP SDK imports ajv which uses CommonJS require() for JSON files.
// This doesn't work in workerd. Wrangler's build process properly bundles
// everything into a single file that works in the Workers runtime.
//
// See: https://github.com/cloudflare/workers-sdk/issues/9822
// See: https://github.com/modelcontextprotocol/typescript-sdk/issues/689
export default defineWorkersConfig({
  test: {
    name: "integration",
    // Pre-build the worker before running tests
    globalSetup: ["./test/global-setup.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        // Point to the pre-built worker entry for SELF binding
        main: "./dist-test/index.js",
        miniflare: {
          kvNamespaces: ["OAUTH_KV"],
          bindings: {
            SENTRY_CLIENT_ID: "test-client-id",
            SENTRY_CLIENT_SECRET: "test-client-secret",
            COOKIE_SECRET: "test-cookie-secret-that-is-32chars",
            SENTRY_HOST: "sentry.io",
          },
          modules: true,
          compatibilityDate: "2025-03-21",
          compatibilityFlags: [
            "nodejs_compat",
            "nodejs_compat_populate_process_env",
          ],
        },
      },
    },
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
