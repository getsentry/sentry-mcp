#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startStdio } from "@sentry/mcp-server/transports/stdio";
import { mswServer } from "@sentry/mcp-server-mocks";
import { SKILLS, type Skill } from "@sentry/mcp-core/skills";

mswServer.listen({
  onUnhandledRequest: (req, print) => {
    if (req.url.startsWith("https://api.openai.com/")) {
      return;
    }

    print.warning();
    throw new Error(`Unhandled request: ${req.url}`);
  },
  // onUnhandledRequest: "error"
});

const accessToken = "mocked-access-token";

// Grant all available skills for evals to ensure MSW mocks apply broadly
const allSkills = Object.keys(SKILLS) as Skill[];

const server = new McpServer({
  name: "Sentry MCP",
  version: "0.1.0",
});

// Run in-process MCP with all skills so MSW mocks apply
startStdio(server, {
  accessToken,
  grantedSkills: new Set<Skill>(allSkills),
  constraints: {
    organizationSlug: null,
    projectSlug: null,
  },
}).catch((err: unknown) => {
  console.error("Server error:", err);
  process.exit(1);
});
