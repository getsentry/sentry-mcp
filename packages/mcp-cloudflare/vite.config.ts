import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    cloudflare(),
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
    strictPort: true, // Fail if port is in use
  },
  // Enable instrumentation for coverage in e2e test mode
  define:
    mode === "e2e-test"
      ? {
          __COVERAGE__: true,
        }
      : {},
}));
