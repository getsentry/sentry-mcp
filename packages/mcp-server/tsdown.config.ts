import { defineConfig } from "tsdown";
import { readFileSync } from "node:fs";

export default defineConfig({
  entry: ["src/**/*.ts"],
  format: ["cjs", "esm"], // Build for commonJS and ESmodules
  dts: true, // Generate declaration file (.d.ts)
  sourcemap: true,
  clean: true,
  env: {
    DEFAULT_SENTRY_DSN:
      "https://d0805acebb937435abcb5958da99cdab@o1.ingest.us.sentry.io/4509062593708032",
    SENTRY_ENVIRONMENT: "stdio",
    npm_package_version:
      process.env.npm_package_version ??
      JSON.parse(readFileSync("./package.json")).version,
  },
});
