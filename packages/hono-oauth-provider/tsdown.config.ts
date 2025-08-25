import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  dts: true,
  platform: "node",
  target: "es2022",
  skipNodeModulesBundle: true,
});