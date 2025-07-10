import { describe, expect, it, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import { RESOURCES, isTemplateResource } from "./resources";
import { UserInputError } from "./errors";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

beforeEach(() => {
  mswServer.resetHandlers();
});

describe("resources", () => {
  describe("isTemplateResource", () => {
    it("should correctly identify template resources", () => {
      const staticResource = RESOURCES.find(
        (r) => r.name === "sentry-query-syntax",
      );
      const templateResource = RESOURCES.find(
        (r) => r.name === "sentry-docs-platform",
      );

      expect(staticResource).toBeDefined();
      expect(templateResource).toBeDefined();

      expect(isTemplateResource(staticResource!)).toBe(false);
      expect(isTemplateResource(templateResource!)).toBe(true);
    });
  });

  describe("sentryDocsHandler", () => {
    it("should fetch markdown version of Sentry docs", async () => {
      const mockContent =
        "# Sentry JavaScript SDK\n\nThis is the documentation...";

      mswServer.use(
        http.get("https://docs.sentry.io/platforms/javascript.md", () => {
          return HttpResponse.text(mockContent);
        }),
      );

      const docsResource = RESOURCES.find(
        (r) => r.name === "sentry-docs-platform",
      );
      expect(docsResource).toBeDefined();

      const result = await docsResource!.handler(
        new URL("https://docs.sentry.io/platforms/javascript/"),
        {} as RequestHandlerExtra<any, any>,
      );

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toEqual({
        uri: "https://docs.sentry.io/platforms/javascript/",
        mimeType: "text/markdown",
        text: mockContent,
      });
    });

    it("should handle trailing slashes correctly", async () => {
      const mockContent = "# Guide Content";

      mswServer.use(
        http.get(
          "https://docs.sentry.io/platforms/javascript/guides/nextjs.md",
          () => {
            return HttpResponse.text(mockContent);
          },
        ),
      );

      const guideResource = RESOURCES.find(
        (r) => r.name === "sentry-docs-platform-guide",
      );
      expect(guideResource).toBeDefined();

      // Test with trailing slash
      const result = await guideResource!.handler(
        new URL("https://docs.sentry.io/platforms/javascript/guides/nextjs/"),
        {} as RequestHandlerExtra<any, any>,
      );

      expect(result.contents[0].text).toBe(mockContent);
    });

    it("should throw UserInputError for 404 responses", async () => {
      mswServer.use(
        http.get("https://docs.sentry.io/platforms/nonexistent.md", () => {
          return new HttpResponse(null, { status: 404 });
        }),
      );

      const docsResource = RESOURCES.find(
        (r) => r.name === "sentry-docs-platform",
      );

      await expect(
        docsResource!.handler(
          new URL("https://docs.sentry.io/platforms/nonexistent/"),
          {} as RequestHandlerExtra<any, any>,
        ),
      ).rejects.toThrow(UserInputError);

      await expect(
        docsResource!.handler(
          new URL("https://docs.sentry.io/platforms/nonexistent/"),
          {} as RequestHandlerExtra<any, any>,
        ),
      ).rejects.toThrow(
        "Sentry documentation not found at /platforms/nonexistent/. Please check the URL is correct.",
      );
    });

    it("should throw regular Error for other HTTP errors", async () => {
      mswServer.use(
        http.get("https://docs.sentry.io/platforms/error.md", () => {
          return new HttpResponse(null, {
            status: 500,
            statusText: "Internal Server Error",
          });
        }),
      );

      const docsResource = RESOURCES.find(
        (r) => r.name === "sentry-docs-platform",
      );

      await expect(
        docsResource!.handler(
          new URL("https://docs.sentry.io/platforms/error/"),
          {} as RequestHandlerExtra<any, any>,
        ),
      ).rejects.toThrow(
        "Failed to fetch Sentry docs: 500 Internal Server Error",
      );

      // Ensure it's not a UserInputError
      await expect(
        docsResource!.handler(
          new URL("https://docs.sentry.io/platforms/error/"),
          {} as RequestHandlerExtra<any, any>,
        ),
      ).rejects.not.toThrow(UserInputError);
    });
  });

  describe("defaultGitHubHandler", () => {
    it("should fetch raw GitHub content", async () => {
      const mockContent = "# Query Syntax Documentation";

      mswServer.use(
        http.get(
          "https://raw.githubusercontent.com/getsentry/sentry-ai-rules/main/api/query-syntax.mdc",
          () => {
            return HttpResponse.text(mockContent);
          },
        ),
      );

      const syntaxResource = RESOURCES.find(
        (r) => r.name === "sentry-query-syntax",
      );
      expect(syntaxResource).toBeDefined();

      const result = await syntaxResource!.handler(
        new URL(
          "https://github.com/getsentry/sentry-ai-rules/blob/main/api/query-syntax.mdc",
        ),
        {} as RequestHandlerExtra<any, any>,
      );

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toEqual({
        uri: "https://github.com/getsentry/sentry-ai-rules/blob/main/api/query-syntax.mdc",
        mimeType: "text/plain",
        text: mockContent,
      });
    });
  });
});
