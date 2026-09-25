import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryCloudflareVitePlugin } from "@sentry/cloudflare/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { generateHomepageFallbackHtml } from "./src/homepage-content";

const STATIC_HOME_RE =
  /<!--app-static-home-start-->[\s\S]*?<!--app-static-home-end-->/;

/**
 * Inject the shared llms.txt/homepage body into the SPA shell.
 *
 * Placed inside #root so:
 * - no-JS browsers render the content (html.js class is never added)
 * - HTML scrapers / WebFetch see real body text in the document
 * - JS browsers hide #static-home via the early head script, then React
 *   replaces #root on mount
 */
function homepageFallbackHtmlPlugin(): Plugin {
  return {
    name: "homepage-fallback-html",
    transformIndexHtml(html) {
      const fallback = generateHomepageFallbackHtml();
      return html.replace(
        STATIC_HOME_RE,
        `<!--app-static-home-start-->\n    ${fallback}\n    <!--app-static-home-end-->`,
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    tailwindcss(),
    homepageFallbackHtmlPlugin(),
    sentryCloudflareVitePlugin(),
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
});
