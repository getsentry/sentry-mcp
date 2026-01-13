import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import getIssueExternalLinks from "./get-issue-external-links";
import { getServerContext } from "../test-helpers/server";

describe("get-issue-external-links tool", () => {
  beforeEach(() => {
    getServerContext().reset();
  });

  describe("successful calls", () => {
    it("should fetch external issue links for an issue", async () => {
      const mockExternalIssues = [
        {
          id: "123",
          issueId: "456",
          serviceType: "jira",
          displayName: "AMP-12345",
          webUrl: "https://amplitude.atlassian.net/browse/AMP-12345",
        },
        {
          id: "124",
          issueId: "456",
          serviceType: "github",
          displayName: "getsentry/sentry#12345",
          webUrl: "https://github.com/getsentry/sentry/issues/12345",
        },
      ];

      const server = getServerContext();
      server.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/issues/PROJECT-123/external-issues/",
          () => {
            return HttpResponse.json(mockExternalIssues);
          },
        ),
      );

      const result = await getIssueExternalLinks.handler(
        {
          organizationSlug: "test-org",
          issueId: "PROJECT-123",
          regionUrl: null,
        },
        server.context,
      );

      expect(result).toContain("# External Issue Links for PROJECT-123");
      expect(result).toContain("Found 2 external issue link(s)");
      expect(result).toContain("## AMP-12345");
      expect(result).toContain("**Type**: jira");
      expect(result).toContain(
        "https://amplitude.atlassian.net/browse/AMP-12345",
      );
      expect(result).toContain("## getsentry/sentry#12345");
      expect(result).toContain("**Type**: github");
      expect(result).toContain(
        "https://github.com/getsentry/sentry/issues/12345",
      );
    });

    it("should return message when no external issues are linked", async () => {
      const server = getServerContext();
      server.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/issues/PROJECT-456/external-issues/",
          () => {
            return HttpResponse.json([]);
          },
        ),
      );

      const result = await getIssueExternalLinks.handler(
        {
          organizationSlug: "test-org",
          issueId: "PROJECT-456",
          regionUrl: null,
        },
        server.context,
      );

      expect(result).toContain("# No External Issues Found");
      expect(result).toContain(
        "No external issue tracking links (Jira, GitHub, etc.)",
      );
      expect(result).toContain("**Issue ID**: PROJECT-456");
      expect(result).toContain("**Organization**: test-org");
    });
  });

  describe("issueUrl parameter", () => {
    it("should extract organization and issue ID from Sentry URL", async () => {
      const mockExternalIssues = [
        {
          id: "789",
          issueId: "999",
          serviceType: "jira",
          displayName: "DASH-1Q3H",
          webUrl: "https://amplitude.atlassian.net/browse/DASH-1Q3H",
        },
      ];

      const server = getServerContext();
      server.use(
        http.get(
          "https://sentry.io/api/0/organizations/my-org/issues/ISSUE-789/external-issues/",
          () => {
            return HttpResponse.json(mockExternalIssues);
          },
        ),
      );

      const result = await getIssueExternalLinks.handler(
        {
          issueUrl: "https://my-org.sentry.io/issues/ISSUE-789/",
          regionUrl: null,
        },
        server.context,
      );

      expect(result).toContain("# External Issue Links for ISSUE-789");
      expect(result).toContain("## DASH-1Q3H");
      expect(result).toContain("**Type**: jira");
    });
  });

  describe("error handling", () => {
    it("should throw error when neither issueId nor issueUrl is provided", async () => {
      const server = getServerContext();

      await expect(
        getIssueExternalLinks.handler(
          {
            organizationSlug: "test-org",
            regionUrl: null,
          },
          server.context,
        ),
      ).rejects.toThrow("Either `issueId` or `issueUrl` must be provided");
    });

    it("should throw error when organizationSlug is missing with issueId", async () => {
      const server = getServerContext();

      await expect(
        getIssueExternalLinks.handler(
          {
            issueId: "PROJECT-123",
            regionUrl: null,
          },
          server.context,
        ),
      ).rejects.toThrow(
        "`organizationSlug` is required when providing `issueId`",
      );
    });

    it("should handle 404 errors gracefully", async () => {
      const server = getServerContext();
      server.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/issues/NONEXISTENT/external-issues/",
          () => {
            return HttpResponse.json(
              { detail: "The requested resource does not exist" },
              { status: 404 },
            );
          },
        ),
      );

      await expect(
        getIssueExternalLinks.handler(
          {
            organizationSlug: "test-org",
            issueId: "NONEXISTENT",
            regionUrl: null,
          },
          server.context,
        ),
      ).rejects.toThrow();
    });
  });
});
