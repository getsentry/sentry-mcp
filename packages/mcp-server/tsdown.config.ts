import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts"],
  format: ["cjs", "esm"], // Build for commonJS and ESmodules
  dts: true, // Generate declaration file (.d.ts)
  sourcemap: true,
  clean: true,
  env: {
    DEFAULT_SENTRY_DSN:
      "https://7f7bbaad9504b727cdf8edc378c6d1de@o1.ingest.us.sentry.io/4509062593708032",
    SENTRY_ENVIRONMENT: "stdio",
  },
});
