import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/shared/**/*.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/shared",
});
