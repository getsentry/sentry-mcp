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

function mockOrganizations(organizations: unknown[]) {
  mswServer.use(
    http.get("https://sentry.io/api/0/organizations/", ({ request }) => {
      expect(new URL(request.url).searchParams.get("per_page")).toBe("26");
      return HttpResponse.json(organizations);
    }),
  );
}

describe("find_organizations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["sentry.io", "sentry.io"],
    ["us.sentry.io", "sentry.io"],
    ["de.sentry.io", "sentry.io"],
    ["example.sentry.io", "sentry.io"],
    ["example.my.sentry.io", "example.my.sentry.io"],
    ["sentry.example.com", "sentry.example.com"],
  ])("lists organizations from %s through %s", async (host, expectedHost) => {
    const requests: { url: string; authorization: string | null }[] = [];
    mswServer.use(
      http.get("*", ({ request }) => {
        requests.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
        });
        return HttpResponse.json([
          { id: "1", slug: "example", name: "Example" },
        ]);
      }),
    );

    const result = await findOrganizations.handler(
      { query: "example" },
      getServerContext({ sentryHost: host, accessToken: "test-token" }),
    );

    expect(requests).toEqual([
      {
        url: `https://${expectedHost}/api/0/organizations/?per_page=26&query=example`,
        authorization: "Bearer test-token",
      },
    ]);
    expect(getStructuredContent(result)).toEqual({
      organizations: [{ slug: "example", webUrl: null, regionUrl: null }],
      hasMore: false,
    });
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
      { query: null },
      getServerContext(),
    );

    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "hasMore": false,
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
    ).mockResolvedValueOnce([
      {
        id: "1",
        slug: "whitespace-region-org",
        name: "Whitespace Region Org",
        links: {
          organizationUrl: "https://sentry.io/whitespace-region-org",
          regionUrl: " \t\n ",
        },
      },
    ]);

    const result = await findOrganizations.handler(
      { query: null },
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
    });
    assertStructuredOnlyResult(result);
  });

  it("requests 26 organizations and returns 25 with hasMore", async () => {
    mockOrganizations(
      Array.from({ length: 26 }, (_, index) => ({
        id: String(index + 1),
        slug: `organization-${index + 1}`,
        name: `Organization ${index + 1}`,
        links: {
          organizationUrl: `https://sentry.io/organization-${index + 1}`,
          regionUrl: "https://us.sentry.io",
        },
      })),
    );

    const result = await findOrganizations.handler(
      { query: null },
      getServerContext(),
    );
    const structuredContent = getStructuredContent<{
      organizations: Array<{ slug: string }>;
      hasMore: boolean;
    }>(result);

    expect(structuredContent.organizations).toHaveLength(25);
    expect(structuredContent.organizations.at(-1)?.slug).toBe(
      "organization-25",
    );
    expect(structuredContent.hasMore).toBe(true);
    assertStructuredOnlyResult(result);
  });
});
