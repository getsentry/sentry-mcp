#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "./transports/stdio.js";
import { mswServer } from "../lib/sentry-msw.js";

let accessToken = process.env.SENTRY_AUTH_TOKEN;

if (process.argv.includes("--mocks")) {
  mswServer.listen({
    onUnhandledRequest: (req, print) => {
      if (req.url.startsWith("https://api.openai.com/")) {
        return;
      }

      print.warning();
      throw new Error("Unhandled request");
    },
    // onUnhandledRequest: "error"
  });

  accessToken = "mocked-access-token";
} else {
  try {
    mswServer.close();
  } catch (e) {
    console.log(
      "Note: MSW server was not running or encountered an error while closing",
    );
  }
}

if (!accessToken) {
  console.error("SENTRY_AUTH_TOKEN is not set");
  process.exit(1);
}

const server = new McpServer({
  name: "Sentry MCP",
  version: "0.1.0",
});

// XXX: we could do what we're doing in routes/auth.ts and pass the context
// identically, but we don't really need userId and userName yet
startStdio(server, {
  accessToken,
  organizationSlug: null,
}).catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
