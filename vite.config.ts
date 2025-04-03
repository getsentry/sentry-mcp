import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import ssrHotReload from "vite-plugin-ssr-hot-reload";
import build from "@hono/vite-build/cloudflare-workers";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode, command }) => {
  if (command === "build") {
    if (mode === "client") {
      return {
        esbuild: {
          exclude: ["react", "react-dom"],
        },
        build: {
          rollupOptions: {
            output: {
              // entryFileNames: "static/client.js",
              assetFileNames: "static/assets/[name].[ext]",
            },
            input: ["./src/web/handler.tsx", "./src/style.css"],
          },
        },
        plugins: [tailwindcss()],
      };
    }
    return {
      resolve: {
        alias: {
          "react-dom/server": "react-dom/server.edge",
        },
      },
      plugins: [build({ entry: "./src/app.ts" }), tailwindcss()],
    };
  }
  return {
    plugins: [
      ssrHotReload({
        entry: ["./src/web/*"],
        injectReactRefresh: true,
      }),
      react(),
      cloudflare(),
      tailwindcss(),
    ],
  };
});
