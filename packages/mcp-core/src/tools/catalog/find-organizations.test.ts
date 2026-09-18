import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SentryApiService } from "../../api-client/index.js";
import { getServerContext } from "../../test-setup.js";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import findOrganizations from "./find-organizations.js";

function mockOrganizations(
  organizations: unknown[],
  headers?: Record<string, string>,
) {
  mswServer.use(
    http.get("https://sentry.io/api/0/organizations/", ({ request }) => {
      expect(new URL(request.url).searchParams.get("per_page")).toBe("100");
      return HttpResponse.json(
        organizations,
        headers ? { headers } : undefined,
      );
    }),
  );
}

describe("find_organizations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only the structured organization payload", async () => {
    mockOrganizations([
      {
        id: "1",
        slug: "cloud-org",
        name: "Cloud Org",
        links: {
          organizationUrl: "https://sentry.io/cloud-org",
          regionUrl: "https://us.sentry.io",
        },
      },
      {
        id: "2",
        slug: "self-hosted-org",
        name: "Self-hosted Org",
      },
    ]);

    const result = await findOrganizations.handler(
      { query: null, cursor: null },
      getServerContext(),
    );

    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "hasMore": false,
        "nextCursor": null,
        "organizations": [
          {
            "regionUrl": "https://us.sentry.io",
            "slug": "cloud-org",
            "webUrl": "https://sentry.io/cloud-org",
          },
          {
            "regionUrl": null,
            "slug": "self-hosted-org",
            "webUrl": null,
          },
        ],
      }
    `);
    assertStructuredOnlyResult(result);
  });

  it("maps a whitespace-only region URL to null", async () => {
    vi.spyOn(
      SentryApiService.prototype,
      "listOrganizations",
    ).mockResolvedValueOnce({
      organizations: [
        {
          id: "1",
          slug: "whitespace-region-org",
          name: "Whitespace Region Org",
          links: {
            organizationUrl: "https://sentry.io/whitespace-region-org",
            regionUrl: " \t\n ",
          },
        },
      ],
      nextCursor: null,
    });

    const result = await findOrganizations.handler(
      { query: null, cursor: null },
      getServerContext(),
    );

    expect(getStructuredContent(result)).toEqual({
      organizations: [
        {
          slug: "whitespace-region-org",
          webUrl: "https://sentry.io/whitespace-region-org",
          regionUrl: null,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    assertStructuredOnlyResult(result);
  });

  it("returns up to 100 organizations per call and reports a cursor when there are more", async () => {
    mockOrganizations(
      Array.from({ length: 100 }, (_, index) => ({
        id: String(index + 1),
        slug: `organization-${index + 1}`,
        name: `Organization ${index + 1}`,
        links: {
          organizationUrl: `https://sentry.io/organization-${index + 1}`,
          regionUrl: "https://us.sentry.io",
        },
      })),
      {
        Link: '<https://sentry.io/api/0/organizations/?cursor=page-2>; rel="next"; results="true"; cursor="page-2"',
      },
    );

    const result = await findOrganizations.handler(
      { query: null, cursor: null },
      getServerContext(),
    );
    const structuredContent = getStructuredContent<{
      organizations: Array<{ slug: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    }>(result);

    expect(structuredContent.organizations).toHaveLength(100);
    expect(structuredContent.organizations.at(-1)?.slug).toBe(
      "organization-100",
    );
    expect(structuredContent.hasMore).toBe(true);
    expect(structuredContent.nextCursor).toBe("page-2");
    assertStructuredOnlyResult(result);
  });
});
