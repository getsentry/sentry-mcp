import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";

export function setupMockServer(handlers: Array<any> = []): SetupServer {
  return setupServer(...handlers);
}

/**
 * Start the MSW server with common configuration for Sentry MCP tests
 * This helper ensures consistent configuration across all test suites
 */
export function startMockServer(options?: {
  ignoreOpenAI?: boolean;
}): void {
  const { ignoreOpenAI = true } = options || {};

  // Import here to avoid circular dependency
  const { mswServer } = require("./index");

  mswServer.listen({
    onUnhandledRequest: (req: any, print: any) => {
      // Ignore OpenAI requests if specified (default behavior for AI agent tests)
      if (ignoreOpenAI && req.url.startsWith("https://api.openai.com/")) {
        return;
      }

      print.warning();
      throw new Error(`Unhandled request: ${req.method} ${req.url}`);
    },
  });
}
