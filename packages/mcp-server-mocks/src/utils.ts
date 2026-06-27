import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { mswServer } from "./index.js";

export function setupMockServer(handlers: Array<any> = []): SetupServer {
  return setupServer(...handlers);
}

export function isLLMProviderRequest(requestUrl: string): boolean {
  const url = new URL(requestUrl);

  if (
    url.hostname === "api.openai.com" ||
    url.hostname === "api.anthropic.com" ||
    url.hostname === "openrouter.ai"
  ) {
    return true;
  }

  return (
    url.hostname.endsWith(".openai.azure.com") &&
    url.pathname.startsWith("/openai/")
  );
}

/**
 * Start the MSW server with common configuration for Sentry MCP tests
 * This helper ensures consistent configuration across all test suites
 */
export function startMockServer(options?: {
  ignoreLLMProviderRequests?: boolean;
}): void {
  const { ignoreLLMProviderRequests = true } = options || {};

  mswServer.listen({
    onUnhandledRequest: (req: any, print: any) => {
      // Ignore LLM provider calls while still failing on unmocked Sentry/API requests.
      if (ignoreLLMProviderRequests && isLLMProviderRequest(req.url)) {
        return;
      }

      print.warning();
      throw new Error(`Unhandled request: ${req.method} ${req.url}`);
    },
  });
}
