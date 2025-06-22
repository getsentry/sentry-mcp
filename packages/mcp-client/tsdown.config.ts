import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  platform: "node",
  minify: false,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
