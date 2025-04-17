import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    tailwindcss(),
    sentryVitePlugin({
      org: "sentry",
      project: "remote-mcp",
    }),
  ],

  build: {
    sourcemap: true,
  },
});
