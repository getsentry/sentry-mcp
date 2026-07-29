import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import createDsn from "./create-dsn.js";
import { getServerContext } from "../../test-setup.js";

describe("create_dsn", () => {
  it("returns the created DSN as structured content", async () => {
    mswServer.use(
      http.post(
        "https://sentry.io/api/0/projects/*/*/keys/",
        async ({ request }) => {
          expect(new URL(request.url).pathname).toBe(
            "/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
          );
          await expect(request.json()).resolves.toEqual({ name: "Default" });

          return HttpResponse.json({
            id: 12345,
            name: "Default",
            dsn: {
              public: "https://public@example.ingest.sentry.io/12345",
              secret: "backend-only-secret",
            },
            isActive: true,
            dateCreated: "2026-07-28T00:00:00.000Z",
            browserSdkVersion: "9.0.0",
            backendOnlyField: "must-not-leak",
          });
        },
        { once: true },
      ),
    );

    const result = await createDsn.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        projectSlug: "cloudflare-mcp",
        name: "Default",
        regionUrl: null,
      },
      getServerContext(),
    );

    expect(result.structuredContent).toMatchInlineSnapshot(`
      {
        "dsn": {
          "dsn": "https://public@example.ingest.sentry.io/12345",
          "id": "12345",
          "name": "Default",
        },
      }
    `);
    expect(result.structuredContent).not.toHaveProperty("isActive");
    expect(result.structuredContent.dsn).not.toHaveProperty("secret");
    expect(result.structuredContent).not.toHaveProperty("backendOnlyField");
  });
});
