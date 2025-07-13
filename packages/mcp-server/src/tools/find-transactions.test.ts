import { describe, it, expect } from "vitest";
import findTransactions from "./find-transactions.js";

describe("find_transactions", () => {
  it("serializes", async () => {
    const result = await findTransactions.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectId: undefined,
        transaction: undefined,
        query: undefined,
        sortBy: "duration",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Transactions in **sentry-mcp-evals**


      ## \`GET /trpc/bottleList\`

      **Span ID**: 07752c6aeb027c8f
      **Trace ID**: 6a477f5b0f31ef7b6b9b5e1dea66c91d
      **Span Operation**: http.server
      **Span Description**: GET /trpc/bottleList
      **Duration**: 12
      **Timestamp**: 2025-04-13T14:19:18+00:00
      **Project**: peated
      **URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/6a477f5b0f31ef7b6b9b5e1dea66c91d

      ## \`GET /trpc/bottleList\`

      **Span ID**: 7ab5edf5b3ba42c9
      **Trace ID**: 54177131c7b192a446124daba3136045
      **Span Operation**: http.server
      **Span Description**: GET /trpc/bottleList
      **Duration**: 18
      **Timestamp**: 2025-04-13T14:19:17+00:00
      **Project**: peated
      **URL**: https://sentry-mcp-evals.sentry.io/explore/traces/trace/54177131c7b192a446124daba3136045

      "
    `);
  });
});
