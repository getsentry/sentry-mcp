import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts"],
  format: ["cjs", "esm"], // Build for commonJS and ESmodules
  dts: true, // Generate declaration file (.d.ts)
  sourcemap: true,
  clean: true,
});
