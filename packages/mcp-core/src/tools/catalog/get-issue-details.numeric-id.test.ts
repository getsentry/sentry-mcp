import {
  autofixStateFixture,
  eventsFixture,
  issueFixture,
  mswServer,
} from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import getIssueDetails from "./get-issue-details";
import getSentryResource from "./get-sentry-resource";

const organizationSlug = "sentry-mcp-evals";
const issueId = String(issueFixture.id);
const eventId = eventsFixture.id;
const issueUrl = `https://${organizationSlug}.sentry.io/issues/${issueId}/`;
const context = {
  constraints: { organizationSlug: undefined },
  accessToken: "access-token",
  userId: "1",
};

// Short IDs for legacy mixed-case project slugs can fail to resolve even though
// the numeric ID works. Reject every short-ID follow-up, including optional data.
describe("issue details with an unresolvable short ID", () => {
  it.each([
    {
      name: "numeric issue ID",
      call: () =>
        getIssueDetails.handler(
          { organizationSlug, issueId, regionUrl: null },
          context,
        ),
    },
    {
      name: "issue URL",
      call: () =>
        getIssueDetails.handler({ issueUrl, regionUrl: null }, context),
    },
    {
      name: "numeric issue ID and explicit event ID",
      call: () =>
        getIssueDetails.handler(
          { organizationSlug, issueId, eventId, regionUrl: null },
          context,
        ),
    },
    {
      name: "event ID resolved through issue search",
      call: () =>
        getIssueDetails.handler(
          { organizationSlug, eventId, regionUrl: null },
          context,
        ),
    },
    {
      name: "resource issue URL",
      call: () => getSentryResource.handler({ url: issueUrl }, context),
    },
    {
      name: "resource event URL",
      call: () =>
        getSentryResource.handler(
          { url: `${issueUrl}events/${eventId}/` },
          context,
        ),
    },
  ])("loads $name and enrichment by numeric ID", async ({ call }) => {
    const requestedIssueIds: string[] = [];
    const base = `https://sentry.io/api/0/organizations/${organizationSlug}`;
    mswServer.use(
      http.get(`${base}/issues/`, () => HttpResponse.json([issueFixture])),
      http.get(`${base}/issues/:issueId/*`, ({ params, request }) => {
        const requestedId = String(params.issueId);
        requestedIssueIds.push(requestedId);
        if (requestedId !== issueId) {
          return HttpResponse.json(
            { detail: "The requested resource does not exist" },
            { status: 404 },
          );
        }
        const path = new URL(request.url).pathname;
        if (path.includes("/events/")) {
          return HttpResponse.json(eventsFixture);
        }
        if (path.endsWith("/external-issues/")) {
          return HttpResponse.json([
            {
              id: "123",
              issueId,
              serviceType: "github",
              displayName: "example/app#123",
              webUrl: "https://github.com/example/app/issues/123",
            },
          ]);
        }
        if (path.endsWith("/autofix/")) {
          return HttpResponse.json(autofixStateFixture);
        }
        return HttpResponse.json(issueFixture);
      }),
    );

    const result = await call();

    expect(result).toContain(`Issue ${issueFixture.shortId}`);
    expect(result).toContain(eventsFixture.id);
    expect(result).toContain("## Seer Analysis");
    expect(result).toContain("**example/app#123** (github)");
    expect(requestedIssueIds.length).toBeGreaterThanOrEqual(3);
    expect(new Set(requestedIssueIds)).toEqual(new Set([issueId]));
  });
});
