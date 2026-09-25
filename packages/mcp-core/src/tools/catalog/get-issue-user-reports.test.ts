import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import getIssueUserReports from "./get-issue-user-reports.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

afterEach(() => {
  mswServer.resetHandlers();
});

describe("get_issue_user_reports", () => {
  it("serializes user feedback for an issue", async () => {
    const result = await getIssueUserReports.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-41",
        cursor: null,
        limit: 25,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Issue User Reports for Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**

      - 2026-06-22T02:37:27.878Z by Example Reporter:
        - "i am currently testing it"
      - 2026-06-22T03:10:11.123Z by anonymous:
        - "anonymous report with no event user"
      - 2026-06-22T03:45:12.456Z by anonymous:
        - "event user shell without identity"
      "
    `);
  });

  it("returns pagination guidance when more reports are available", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/:org/issues/:issueId/user-reports/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("per_page")).toBe("1");
          expect(url.searchParams.get("cursor")).toBe("page-1");
          return HttpResponse.json(
            [
              {
                id: "11974229",
                eventID: "157c1ee8f31e4e68a57b637dad557b34",
                name: "",
                email: "",
                comments: "reported by event user",
                dateCreated: "2026-06-22T04:20:21.987654Z",
                user: {
                  id: "user-456",
                  username: "event-user",
                  email: null,
                  name: null,
                  ipAddress: null,
                  avatarUrl: null,
                },
                event: {
                  id: "157c1ee8f31e4e68a57b637dad557b34",
                  eventID: "157c1ee8f31e4e68a57b637dad557b34",
                },
              },
            ],
            {
              headers: {
                Link: '<https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/user-reports/?cursor=page-2>; rel="next"; results="true"; cursor="page-2"',
              },
            },
          );
        },
      ),
    );

    const result = await getIssueUserReports.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        issueId: "CLOUDFLARE-MCP-41",
        cursor: "page-1",
        limit: 1,
      },
      context,
    );

    expect(result).toContain("by event-user");
    expect(result).toContain('cursor: "page-2"');
  });
});
