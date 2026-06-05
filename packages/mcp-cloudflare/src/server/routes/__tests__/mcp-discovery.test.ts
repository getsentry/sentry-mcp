import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../../app";

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
      endpoints: ["/.mcp/tools.json", "/.mcp/skills.json"],
    });
  });

  it("GET /.mcp/tools.json should return direct tool definitions", async () => {
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
    expect(toolNames).not.toContain("get_issue_activity");
    expect(toolNames).not.toContain("get_trace_details");
    expect(toolNames).toContain("search_events");
  });

  it("GET /.mcp/skills.json should return skill catalog definitions", async () => {
    const res = await app.request(
      "/.mcp/skills.json",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const json = (await res.json()) as Array<{
      id: string;
      tools: Array<{ name: string }>;
    }>;
    const inspectSkill = json.find((skill) => skill.id === "inspect");
    expect(inspectSkill?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "find_alerts",
        "find_monitors",
        "get_alert_details",
        "get_issue_activity",
        "get_monitor_details",
        "get_release_details",
      ]),
    );

    const triageSkill = json.find((skill) => skill.id === "triage");
    expect(triageSkill?.tools.map((tool) => tool.name)).toContain(
      "add_issue_note",
    );
  });
});
