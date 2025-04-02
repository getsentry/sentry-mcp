import build from "@hono/vite-build/cloudflare-workers";
import honox from "honox/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  if (mode === "client") {
    return {
      build: {
        manifest: true,
        rollupOptions: {
          input: ["./app/style.css"],
        },
      },
    };
  }
  return {
    plugins: [tailwindcss(), honox(), build()],
  };
});
