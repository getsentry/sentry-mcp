import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";
import getIssueTagValues, {
  getIssueTagValuesOutputSchema,
} from "./get-issue-tag-values.js";
import { getServerContext } from "../../test-setup.js";
import { UserInputError } from "../../errors.js";

describe("get_issue_tag_values", () => {
  it("returns tag value distribution for an issue", async () => {
    const result = await getIssueTagValues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        tagKey: "url",
        regionUrl: null,
        issueUrl: undefined,
      },
      getServerContext(),
    );
    assertStructuredOnlyResult(result);
    expect(getIssueTagValues.outputSchema).toBe(getIssueTagValuesOutputSchema);
    const structuredContent = getStructuredContent(result);
    expect(getIssueTagValuesOutputSchema.parse(structuredContent)).toEqual(
      structuredContent,
    );
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "tag": {
          "key": "url",
          "name": "Url",
          "topValues": [
            {
              "count": 45,
              "firstSeen": "2024-01-10T08:00:00.000Z",
              "lastSeen": "2024-01-15T10:30:00.000Z",
              "value": "/upload/github/org/repo/commit/abc123",
            },
            {
              "count": 32,
              "firstSeen": "2024-01-11T14:20:00.000Z",
              "lastSeen": "2024-01-15T09:45:00.000Z",
              "value": "/api/v1/users/profile",
            },
            {
              "count": 28,
              "firstSeen": "2024-01-12T11:30:00.000Z",
              "lastSeen": "2024-01-15T08:15:00.000Z",
              "value": "/dashboard/overview",
            },
            {
              "count": 21,
              "firstSeen": "2024-01-13T16:45:00.000Z",
              "lastSeen": "2024-01-14T22:00:00.000Z",
              "value": "/settings/notifications",
            },
            {
              "count": 15,
              "firstSeen": "2024-01-14T10:00:00.000Z",
              "lastSeen": "2024-01-14T18:30:00.000Z",
              "value": "/checkout/payment",
            },
          ],
          "totalValues": 156,
        },
      }
    `);
  });

  it("works with issue URL parameter", async () => {
    const result = await getIssueTagValues.handler(
      {
        organizationSlug: undefined,
        issueId: undefined,
        tagKey: "browser",
        regionUrl: null,
        issueUrl:
          "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/",
      },
      getServerContext(),
    );
    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchObject({
      tag: {
        key: "browser",
        name: "Browser",
        totalValues: 156,
      },
    });
  });

  it("rejects issues outside the active project constraint", async () => {
    await expect(
      getIssueTagValues.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          tagKey: "url",
          regionUrl: null,
          issueUrl: undefined,
        },
        getServerContext({
          constraints: {
            projectSlug: "frontend",
          },
        }),
      ),
    ).rejects.toThrow(
      'Issue is outside the active project constraint. Expected project "frontend".',
    );
  });

  it("throws error when neither issueId nor issueUrl provided", async () => {
    await expect(
      getIssueTagValues.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: undefined,
          tagKey: "url",
          regionUrl: null,
          issueUrl: undefined,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("throws error when organizationSlug missing with issueId", async () => {
    await expect(
      getIssueTagValues.handler(
        {
          organizationSlug: undefined,
          issueId: "CLOUDFLARE-MCP-41",
          tagKey: "url",
          regionUrl: null,
          issueUrl: undefined,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("throws error when tagKey is missing", async () => {
    await expect(
      getIssueTagValues.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          tagKey: "",
          regionUrl: null,
          issueUrl: undefined,
        },
        getServerContext(),
      ),
    ).rejects.toThrow(UserInputError);
  });

  it("throws error when tagKey contains path traversal characters", async () => {
    await expect(
      getIssueTagValues.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          tagKey: "../../../admin",
          regionUrl: null,
          issueUrl: undefined,
        },
        getServerContext(),
      ),
    ).rejects.toThrow();
  });

  it("throws error when tagKey contains slashes", async () => {
    await expect(
      getIssueTagValues.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          issueId: "CLOUDFLARE-MCP-41",
          tagKey: "url/path",
          regionUrl: null,
          issueUrl: undefined,
        },
        getServerContext(),
      ),
    ).rejects.toThrow();
  });

  it("handles null values in topValues gracefully", async () => {
    // Override the handler to return null values (which can occur with certain tag types)
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/:org/issues/:issueId/tags/:tagKey/",
        () => {
          return HttpResponse.json({
            key: "custom_tag",
            name: "Custom Tag",
            totalValues: 2,
            topValues: [
              {
                key: "custom_tag",
                name: "valid_value",
                value: "valid_value",
                count: 10,
                lastSeen: "2024-01-15T10:30:00.000Z",
                firstSeen: "2024-01-10T08:00:00.000Z",
              },
              {
                key: "custom_tag",
                name: null,
                value: null,
                count: 5,
                lastSeen: null,
                firstSeen: null,
              },
            ],
          });
        },
      ),
    );

    const result = await getIssueTagValues.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        issueId: "CLOUDFLARE-MCP-41",
        tagKey: "custom_tag",
        regionUrl: null,
        issueUrl: undefined,
      },
      getServerContext(),
    );

    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toEqual({
      tag: {
        key: "custom_tag",
        name: "Custom Tag",
        totalValues: 2,
        topValues: [
          {
            value: "valid_value",
            count: 10,
            firstSeen: "2024-01-10T08:00:00.000Z",
            lastSeen: "2024-01-15T10:30:00.000Z",
          },
          {
            value: null,
            count: 5,
            firstSeen: null,
            lastSeen: null,
          },
        ],
      },
    });
  });
});
