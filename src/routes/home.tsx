import { Hono } from "hono";
import SentryMCP from "../mcp";
import { Link } from "honox/server";

export default new Hono<{
  Bindings: Env & {
    MCP_OBJECT: DurableObjectNamespace<SentryMCP>;
  };
}>().get("/", async (c) => {
  return c.html(
    <html lang="en">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <head>
        <title>Sentry MCP</title>
        <Link href="/app/style.css" rel="stylesheet" />
      </head>
      <body className="text-white">
        <h1>Sentry MCP</h1>
        <p>
          This service provides a Model Context Provider for interacting with{" "}
          <a href="https://docs.sentry.io/api/">Sentry's API</a>.
        </p>
        <pre>
          {JSON.stringify(
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
          )}
        </pre>
        <p>
          <strong>
            Note: This service is a work-in-progress and should not be
            considered stable.
          </strong>
        </p>
        <h2>Available Tools</h2>
        <p>TODO:</p>
        <footer>
          <a href="https://sentry.io">Sentry</a> &middot;{" "}
          <a href="https://github.com/getsentry/sentry-mcp">GitHub</a>
        </footer>
      </body>
    </html>
  );
});
