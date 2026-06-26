import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.test.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    // Only mark test-only packages as external
    "@sentry/mcp-server-mocks",
    // Everything else (including @sentry/mcp-core) will be bundled
  ],
  env: {
    SENTRY_ENVIRONMENT: "stdio",
    npm_package_version: "{{version}}",
  },
});
