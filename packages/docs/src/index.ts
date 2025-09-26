import { Hono } from "hono";

// Define Cloudflare bindings if/when needed
export type Env = Record<string, never>;

const app = new Hono<{ Bindings: Env }>();

app.get("/docs", (c) => {
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Documentation</title>
      <style>
        :root { color-scheme: light dark; }
        body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
        .wrap { display: grid; min-height: 100svh; place-items: center; padding: 2rem; }
        .card { width: min(720px, 100%); border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 12px; padding: 24px; }
        .skeleton { display: grid; gap: 12px; }
        .sk { height: 12px; border-radius: 8px; background: color-mix(in srgb, currentColor 12%, transparent); }
        .sk.lg { height: 18px; }
        .sk.w25 { width: 25%; }
        .sk.w40 { width: 40%; }
        .sk.w60 { width: 60%; }
        .sk.w80 { width: 80%; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <h1 style="margin:0 0 16px 0; font-size: 1.25rem;">Documentation (Placeholder)</h1>
          <div class="skeleton" role="status" aria-label="Loading documentation skeleton">
            <div class="sk lg w40"></div>
            <div class="sk w80"></div>
            <div class="sk w60"></div>
            <div class="sk w80"></div>
            <div class="sk w25"></div>
          </div>
        </div>
      </div>
    </body>
  </html>`;

  return c.html(html);
});

// Default export compatible with Cloudflare Modules
export default { fetch: app.fetch };
