import { describe, expect, it } from "vitest";
import {
  applyProtectedResourceFlags,
  resolveAuthorizationServerUrl,
  resolveProtectedResourceUrl,
} from "./mcp-url.js";

describe("mcp-url helpers", () => {
  it("normalizes an origin-only MCP host to /mcp", () => {
    expect(resolveProtectedResourceUrl("https://mcp.sentry.dev").href).toBe(
      "https://mcp.sentry.dev/mcp",
    );
  });

  it("preserves a scoped protected resource path", () => {
    expect(
      resolveProtectedResourceUrl(
        "https://mcp.sentry.dev/mcp/sentry/javascript?experimental=1",
      ).href,
    ).toBe("https://mcp.sentry.dev/mcp/sentry/javascript?experimental=1");
  });

  it("derives the authorization server from a scoped resource", () => {
    expect(
      resolveAuthorizationServerUrl(
        "https://mcp.sentry.dev/mcp/sentry/javascript",
      ).href,
    ).toBe("https://mcp.sentry.dev/");
  });

  it("applies agent and experimental flags without dropping existing query params", () => {
    const protectedResourceUrl = resolveProtectedResourceUrl(
      "https://mcp.sentry.dev/mcp/sentry/javascript?foo=bar",
    );

    expect(
      applyProtectedResourceFlags(protectedResourceUrl, {
        useAgentEndpoint: true,
        useExperimental: true,
      }).href,
    ).toBe(
      "https://mcp.sentry.dev/mcp/sentry/javascript?foo=bar&agent=1&experimental=1",
    );
  });
});
