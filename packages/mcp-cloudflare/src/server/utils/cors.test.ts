import { describe, expect, it } from "vitest";
import {
  addCorsHeaders,
  isPublicMetadataEndpoint,
  stripCorsHeaders,
} from "./cors";

describe("isPublicMetadataEndpoint", () => {
  it("should match .well-known paths", () => {
    expect(
      isPublicMetadataEndpoint("/.well-known/oauth-authorization-server"),
    ).toBe(true);
    expect(
      isPublicMetadataEndpoint("/.well-known/oauth-protected-resource/mcp"),
    ).toBe(true);
  });

  it("should match .mcp metadata paths", () => {
    expect(isPublicMetadataEndpoint("/.mcp/")).toBe(true);
    expect(isPublicMetadataEndpoint("/.mcp/tools.json")).toBe(true);
  });

  it("should match exact metadata file paths", () => {
    expect(isPublicMetadataEndpoint("/robots.txt")).toBe(true);
    expect(isPublicMetadataEndpoint("/llms.txt")).toBe(true);
    expect(isPublicMetadataEndpoint("/mcp.json")).toBe(true);
  });

  it("should not match OAuth endpoints", () => {
    expect(isPublicMetadataEndpoint("/oauth/token")).toBe(false);
    expect(isPublicMetadataEndpoint("/oauth/register")).toBe(false);
    expect(isPublicMetadataEndpoint("/oauth/authorize")).toBe(false);
  });

  it("should not match MCP endpoint", () => {
    expect(isPublicMetadataEndpoint("/mcp")).toBe(false);
  });
});

describe("addCorsHeaders", () => {
  it("should add restrictive CORS headers", () => {
    const response = new Response("ok", { status: 200 });
    const result = addCorsHeaders(response);

    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(result.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS",
    );
    expect(result.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
  });

  it("should not include Max-Age", () => {
    const response = new Response(null, { status: 204 });
    const result = addCorsHeaders(response);

    expect(result.headers.has("Access-Control-Max-Age")).toBe(false);
  });
});

describe("stripCorsHeaders", () => {
  it("should remove all CORS headers from a response with reflected Origin", () => {
    const response = new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "https://evil.com",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "Authorization, *",
        "Access-Control-Max-Age": "86400",
        "Content-Type": "application/json",
      },
    });

    const result = stripCorsHeaders(response);

    expect(result.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(result.headers.has("Access-Control-Allow-Methods")).toBe(false);
    expect(result.headers.has("Access-Control-Allow-Headers")).toBe(false);
    expect(result.headers.has("Access-Control-Max-Age")).toBe(false);
    expect(result.headers.get("Content-Type")).toBe("application/json");
  });

  it("should return the original response when no CORS headers are present", () => {
    const response = new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

    const result = stripCorsHeaders(response);

    expect(result).toBe(response);
  });

  it("should preserve non-CORS headers", () => {
    const response = new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "https://evil.com",
        "Content-Type": "application/json",
        "X-Request-Id": "abc-123",
      },
    });

    const result = stripCorsHeaders(response);

    expect(result.headers.get("Content-Type")).toBe("application/json");
    expect(result.headers.get("X-Request-Id")).toBe("abc-123");
  });
});
