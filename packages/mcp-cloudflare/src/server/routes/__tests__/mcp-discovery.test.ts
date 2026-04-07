import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { installFetchMockHooks } from "../../../test-utils/fetch-mock-setup";
import app from "../../app";

installFetchMockHooks(fetchMock);

describe("/.mcp discovery routes", () => {
  it("GET /.mcp should return available endpoints", async () => {
    const res = await app.request(
      "/.mcp",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");

    const json = await res.json();
    expect(json).toEqual({
      endpoints: ["/.mcp/tools.json"],
    });
  });

  it("GET /.mcp/tools.json should return tool definitions", async () => {
    const res = await app.request(
      "/.mcp/tools.json",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const json = (await res.json()) as Array<{ name: string }>;
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);

    // Verify tool structure
    const toolNames = json.map((t) => t.name);
    expect(toolNames).toContain("find_organizations");
    expect(toolNames).toContain("get_sentry_resource");
    expect(toolNames).not.toContain("get_issue_details");
    expect(toolNames).not.toContain("get_trace_details");
    expect(toolNames).toContain("search_events");
  });
});
