import { describe, it, expect } from "vitest";
import getIssueTagValues from "./get-issue-tag-values.js";
import { getServerContext } from "../test-setup.js";
import { UserInputError } from "../errors.js";

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
    expect(result).toMatchInlineSnapshot(`
      "# Tag Distribution: Url

      **Issue**: CLOUDFLARE-MCP-41
      **Tag Key**: \`url\`
      **Total Unique Values**: 156

      ## Top Values

      | Value | Count | First Seen | Last Seen |
      |-------|-------|------------|----------|
      | \`/upload/github/org/repo/commit/abc123\` | 45 | 2024-01-10 | 2024-01-15 |
      | \`/api/v1/users/profile\` | 32 | 2024-01-11 | 2024-01-15 |
      | \`/dashboard/overview\` | 28 | 2024-01-12 | 2024-01-15 |
      | \`/settings/notifications\` | 21 | 2024-01-13 | 2024-01-14 |
      | \`/checkout/payment\` | 15 | 2024-01-14 | 2024-01-14 |

      *Showing top 5 of 156 unique values*

      ## Using this information

      - Use \`get_issue_details(issueId='CLOUDFLARE-MCP-41')\` to see the full issue details
      - Try other tag keys like: url, browser, environment, release, os, device, user
      "
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
    expect(result).toContain("# Tag Distribution: Browser");
    expect(result).toContain("**Tag Key**: `browser`");
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
});
