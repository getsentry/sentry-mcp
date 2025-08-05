import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import spotlight from "@spotlightjs/spotlight/vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    tailwindcss(),
    spotlight(),
    sentryVitePlugin({
      org: "sentry",
      project: "mcp-server",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
  },
});
