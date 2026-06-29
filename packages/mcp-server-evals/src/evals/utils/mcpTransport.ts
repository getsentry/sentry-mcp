import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

/** Creates the stdio transport for evals with mocked Sentry auth and host. */
export function createMockMcpTransport() {
  return new Experimental_StdioMCPTransport({
    command: "pnpm",
    args: ["--filter", "@sentry/mcp-server-evals", "start"],
    env: {
      ...process.env,
      SENTRY_ACCESS_TOKEN: "mocked-access-token",
      SENTRY_HOST: "sentry.io",
    },
  });
}
