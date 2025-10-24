import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // Configure external packages for Worker builds
      configPath: "./wrangler.jsonc",
    }),
    tailwindcss(),
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
  server: {
    port: 5173,
    strictPort: true, // Fail if port is already in use instead of trying another port
  },
  // Note: @cloudflare/vite-plugin rejects optimizeDeps.exclude and resolve.external
  // It handles all Workers bundling internally
});
