import { experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { mswServer } from "@sentry/mcp-server-mocks";

// Cache for available tools to avoid reconnecting for each test
let cachedTools: string[] | null = null;

/**
 * Get available tools from the MCP server by connecting to it directly.
 * This ensures the tool list stays in sync with what's actually registered.
 */
export async function getAvailableTools(): Promise<string[]> {
  if (cachedTools) {
    return cachedTools;
  }

  // Start MSW mocks for API isolation
  mswServer.listen({
    onUnhandledRequest: (req, print) => {
      if (req.url.startsWith("https://api.openai.com/")) {
        return;
      }
      // Ignore unhandled requests during tool discovery
    },
  });

  try {
    // Use pnpm exec to run the binary from the workspace
    const transport = new Experimental_StdioMCPTransport({
      command: "pnpm",
      args: ["exec", "sentry-mcp", "--access-token=mocked-access-token"],
      env: {
        ...process.env,
        SENTRY_ACCESS_TOKEN: "mocked-access-token",
        SENTRY_HOST: "sentry.io",
      },
    });

    const client = await experimental_createMCPClient({
      transport,
    });

    // Discover available tools
    const toolsMap = await client.tools();

    // Convert tools to the format expected by the scorer
    cachedTools = Object.entries(toolsMap).map(([name, tool]) => {
      // Extract the first line of description for a concise summary
      const shortDescription = (tool as any).description?.split("\n")[0] || "";
      return `${name} - ${shortDescription}`;
    });

    // Clean up
    await client.close();

    return cachedTools;
  } finally {
    mswServer.close();
  }
}
