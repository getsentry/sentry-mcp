import { Hono } from "hono";
import type SentryMCP from "../lib/sentry-mcp";
import { renderer } from "./renderer";

const copyPasteHelper = `
const nodes = document.querySelectorAll("[data-copy]");
nodes.forEach((button) => {
  button.addEventListener("click", (e) => {
    const text = button.getAttribute("data-copy");
    navigator.clipboard.writeText(decodeURIComponent(text));
  });
});
`;

export default new Hono<{
  Bindings: Env & {
    MCP_OBJECT: DurableObjectNamespace<SentryMCP>;
  };
}>()
  .use(renderer)
  .get("/", async (c) => {
    const mcpSnippet = JSON.stringify(
      {
        mcpServers: {
          sentry: {
            command: "npx",
            args: ["mcp-remote", new URL("/sse", c.req.url).href],
          },
        },
      },
      undefined,
      2
    );

    return c.html(
      <html lang="en">
        <head>
          <title>Sentry MCP</title>
          <link
            href={
              import.meta.env.PROD
                ? "/static/assets/style.css"
                : "/src/style.css"
            }
            rel="stylesheet"
          />
        </head>
        <body className="prose p-4 md:p-8">
          <h1>Sentry MCP</h1>
          <p>
            This service provides a Model Context Provider for interacting with{" "}
            <a href="https://docs.sentry.io/api/">Sentry's API</a>.
          </p>
          <div>
            <button
              className="rounded bg-gray-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-gray-500 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              type="button"
              data-copy={mcpSnippet}
            >
              Copy Configuration
            </button>
            <pre>{mcpSnippet}</pre>
          </div>
          <h2>Available Tools</h2>
          <p>TODO:</p>
          <footer>
            <a href="https://github.com/getsentry/sentry-mcp">GitHub</a>
          </footer>

          <script dangerouslySetInnerHTML={{ __html: copyPasteHelper }} />
        </body>
      </html>
    );
  });
