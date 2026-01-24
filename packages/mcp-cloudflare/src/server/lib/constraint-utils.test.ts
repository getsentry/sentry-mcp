import { describe, it, expect } from "vitest";
import "urlpattern-polyfill";
import { verifyConstraintsAccess } from "./constraint-utils";

describe("verifyConstraintsAccess", () => {
  const token = "test-token";
  const host = "sentry.io";

  it("returns ok with empty constraints when no org constraint provided", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: null, projectSlug: null },
      { accessToken: token, sentryHost: host },
    );
    expect(result).toEqual({
      ok: true,
      constraints: {
        organizationSlug: null,
        projectSlug: null,
        regionUrl: null,
      },
    });
  });

  it("fails when access token is missing, null, undefined, or empty", async () => {
    const testCases = [
      { accessToken: "", label: "empty" },
      { accessToken: null, label: "null" },
      { accessToken: undefined, label: "undefined" },
    ];

    for (const { accessToken, label } of testCases) {
      const result = await verifyConstraintsAccess(
        { organizationSlug: "org", projectSlug: null },
        { accessToken, sentryHost: host },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.message).toBe(
          "Missing access token for constraint verification",
        );
      }
    }
  });

  it("successfully verifies org access and returns constraints with regionUrl", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: "sentry-mcp-evals", projectSlug: null },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.constraints).toEqual({
        organizationSlug: "sentry-mcp-evals",
        projectSlug: null,
        regionUrl: "https://us.sentry.io",
        projectCapabilities: null,
      });
    }
  });

  it("successfully verifies org and project access", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: "sentry-mcp-evals", projectSlug: "cloudflare-mcp" },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.constraints).toEqual({
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        regionUrl: "https://us.sentry.io",
        projectCapabilities: {
          profiles: false,
          replays: false,
          logs: false,
          traces: false,
        },
      });
    }
  });

  it("fails when org does not exist", async () => {
    const result = await verifyConstraintsAccess(
      { organizationSlug: "nonexistent-org", projectSlug: null },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toBe("Organization 'nonexistent-org' not found");
    }
  });

  it("fails when project does not exist", async () => {
    const result = await verifyConstraintsAccess(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "nonexistent-project",
      },
      { accessToken: token, sentryHost: host },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toBe(
        "Project 'nonexistent-project' not found in organization 'sentry-mcp-evals'",
      );
    }
  });
});
