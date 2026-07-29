import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import { describe, it, expect } from "vitest";
import whoami, { whoamiOutputSchema } from "./whoami.js";
import {
  createTestContext,
  createTestContextWithConstraints,
} from "../../test-utils/context.js";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content.js";

describe("whoami", () => {
  it("serializes without constraints", async () => {
    mswServer.use(
      http.get("https://sentry.io/api/0/auth/", () =>
        HttpResponse.json({
          id: 123456,
          name: "Test User",
          email: "test@example.com",
          backendOnlyField: "do-not-leak",
        }),
      ),
    );

    const result = await whoami.handler(
      {},
      createTestContext({
        constraints: {},
        accessToken: "access-token",
        userId: "123456",
      }),
    );
    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(whoami.outputSchema).toBe(whoamiOutputSchema);
    expect(whoamiOutputSchema.safeParse(structuredContent).success).toBe(true);
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "sessionConstraints": null,
        "user": {
          "email": "test@example.com",
          "id": "123456",
          "name": "Test User",
        },
      }
    `);
  });

  it("serializes with constraints", async () => {
    const result = await whoami.handler(
      {},
      createTestContextWithConstraints(
        {
          organizationSlug: "sentry",
          projectSlug: "mcp-server",
          regionUrl: "https://us.sentry.io",
        },
        {
          accessToken: "access-token",
          userId: "123456",
        },
      ),
    );
    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(whoamiOutputSchema.safeParse(structuredContent).success).toBe(true);
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "sessionConstraints": {
          "organizationSlug": "sentry",
          "projectSlug": "mcp-server",
          "regionUrl": "https://us.sentry.io",
        },
        "user": {
          "email": "test@example.com",
          "id": "123456",
          "name": "Test User",
        },
      }
    `);
  });

  it("serializes with partial constraints", async () => {
    const result = await whoami.handler(
      {},
      createTestContextWithConstraints(
        {
          organizationSlug: "sentry",
        },
        {
          accessToken: "access-token",
          userId: "123456",
        },
      ),
    );
    assertStructuredOnlyResult(result);
    const structuredContent = getStructuredContent(result);
    expect(whoamiOutputSchema.safeParse(structuredContent).success).toBe(true);
    expect(structuredContent).toMatchInlineSnapshot(`
      {
        "sessionConstraints": {
          "organizationSlug": "sentry",
        },
        "user": {
          "email": "test@example.com",
          "id": "123456",
          "name": "Test User",
        },
      }
    `);
  });
});
