import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist/apps",
    rollupOptions: {
      input: {
        "search-events-chart": resolve(
          __dirname,
          "src/apps/search-events-chart/index.html",
        ),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
