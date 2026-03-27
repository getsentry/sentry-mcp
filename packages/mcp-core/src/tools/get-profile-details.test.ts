import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getProfileDetails from "./get-profile-details";

const baseContext = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

function callHandler(params: {
  organizationSlug: string;
  projectSlugOrId: string | number;
  profilerId: string;
  start: string;
  end: string;
  regionUrl?: string | null;
  focusOnUserCode?: boolean;
}) {
  return getProfileDetails.handler(
    { regionUrl: null, focusOnUserCode: true, ...params },
    baseContext,
  );
}

describe("get_profile_details", () => {
  describe("handler", () => {
    it("fetches and formats a profile chunk with slug resolution", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/projects/sentry-mcp-evals/backend/",
          () =>
            HttpResponse.json({ id: 12345, slug: "backend", name: "Backend" }),
          { once: true },
        ),
      );

      const result = await callHandler({
        organizationSlug: "sentry-mcp-evals",
        projectSlugOrId: "backend",
        profilerId: "041bde57b9844e36b8b7e5734efae5f7",
        start: "2024-01-01T00:00:00",
        end: "2024-01-01T01:00:00",
      });

      expect(result).toContain("# Profile Chunk Details");
      expect(result).toContain("## Metadata");
      expect(result).toContain("## Sample Summary");
      expect(result).toContain("## Thread Information");
      expect(result).toContain("## Top Frames by Occurrence");
    });

    it("skips slug resolution for numeric project IDs", async () => {
      const result = await callHandler({
        organizationSlug: "sentry-mcp-evals",
        projectSlugOrId: 12345,
        profilerId: "041bde57b9844e36b8b7e5734efae5f7",
        start: "2024-01-01T00:00:00",
        end: "2024-01-01T01:00:00",
      });

      expect(result).toContain("# Profile Chunk Details");
    });

    it("respects focusOnUserCode option", async () => {
      const resultAll = await callHandler({
        organizationSlug: "sentry-mcp-evals",
        projectSlugOrId: 12345,
        profilerId: "041bde57b9844e36b8b7e5734efae5f7",
        start: "2024-01-01T00:00:00",
        end: "2024-01-01T01:00:00",
        focusOnUserCode: false,
      });

      // With focusOnUserCode false, should include library frames
      expect(resultAll).toContain("Library");
    });
  });

  describe("tool definition", () => {
    it("has read-only annotation", () => {
      expect(getProfileDetails.annotations.readOnlyHint).toBe(true);
    });

    it("belongs to inspect skill", () => {
      expect(getProfileDetails.skills).toContain("inspect");
    });

    it("requires profiles capability", () => {
      expect(getProfileDetails.requiredCapabilities).toContain("profiles");
    });

    it("has expected params", () => {
      const schemaKeys = Object.keys(getProfileDetails.inputSchema);
      expect(schemaKeys).toEqual([
        "organizationSlug",
        "regionUrl",
        "projectSlugOrId",
        "profilerId",
        "start",
        "end",
        "focusOnUserCode",
      ]);
    });
  });
});
