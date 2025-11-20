import { describe, it, expect } from "vitest";
import findReleases from "./find-releases.js";

describe("find_releases", () => {
  it("works without project", async () => {
    const result = await findReleases.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: null,
        regionUrl: null,
        query: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Releases in **sentry-mcp-evals**

      ## 8ce89484-0fec-4913-a2cd-e8e2d41dee36

      **Created**: 2025-04-13T19:54:21.764Z
      **First Event**: 2025-04-13T19:54:21.000Z
      **Last Event**: 2025-04-13T20:28:23.000Z
      **New Issues**: 0
      **Projects**: cloudflare-mcp

      # Using this information

      - You can reference the Release version in commit messages or documentation.
      - You can search for issues in a specific release using the \`find_errors()\` tool with the query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });

  it("works with project", async () => {
    const result = await findReleases.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        regionUrl: null,
        query: null,
      },
      {
        constraints: {
          organizationSlug: null,
        },
        accessToken: "access-token",
        userId: "1",
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Releases in **sentry-mcp-evals/cloudflare-mcp**

      ## 8ce89484-0fec-4913-a2cd-e8e2d41dee36

      **Created**: 2025-04-13T19:54:21.764Z
      **First Event**: 2025-04-13T19:54:21.000Z
      **Last Event**: 2025-04-13T20:28:23.000Z
      **New Issues**: 0
      **Projects**: cloudflare-mcp

      # Using this information

      - You can reference the Release version in commit messages or documentation.
      - You can search for issues in a specific release using the \`find_errors()\` tool with the query \`release:8ce89484-0fec-4913-a2cd-e8e2d41dee36\`.
      "
    `);
  });
});
