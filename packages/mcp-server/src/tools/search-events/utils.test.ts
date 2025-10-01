import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import { fetchCustomAttributes } from "./utils";
import { SentryApiService } from "../../api-client";
import * as logging from "../../logging";

describe("fetchCustomAttributes", () => {
  let apiService: SentryApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logging, "logWarn").mockImplementation(() => {});

    // Create a real SentryApiService instance
    apiService = new SentryApiService({
      accessToken: "test-token",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mswServer.resetHandlers();
  });

  describe("403 permission errors", () => {
    it("should throw 403 'no multi-project access' error as UserInputError", async () => {
      // Mock the API to return a 403 error like in the Sentry issue
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          () => {
            return HttpResponse.json(
              {
                detail:
                  "You do not have access to query across multiple projects. Please select a project for your query.",
              },
              { status: 403 },
            );
          },
        ),
      );

      // Should throw ApiPermissionError with the improved error message
      await expect(
        fetchCustomAttributes(apiService, "test-org", "spans"),
      ).rejects.toThrow(
        "You do not have access to query across multiple projects. Please select a project for your query.",
      );

      // Should NOT log - the caller handles logging
    });

    it("should throw 403 errors for logs dataset", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          () => {
            return HttpResponse.json(
              { detail: "Permission denied" },
              { status: 403 },
            );
          },
        ),
      );

      // Should throw ApiPermissionError with the raw error message
      await expect(
        fetchCustomAttributes(apiService, "test-org", "logs", "project-123"),
      ).rejects.toThrow("Permission denied");
    });

    it("should throw 404 errors for errors dataset", async () => {
      mswServer.use(
        http.get("https://sentry.io/api/0/organizations/test-org/tags/", () => {
          return HttpResponse.json(
            { detail: "Project not found" },
            { status: 404 },
          );
        }),
      );

      // Should throw ApiNotFoundError with the raw error message
      await expect(
        fetchCustomAttributes(apiService, "test-org", "errors", "non-existent"),
      ).rejects.toThrow("Project not found");
    });
  });

  describe("5xx server errors", () => {
    it("should re-throw 500 errors to be captured by Sentry", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          () => {
            return HttpResponse.json(
              { detail: "Internal server error" },
              { status: 500 },
            );
          },
        ),
      );

      // Should re-throw the error with the exact message (not wrapped as UserInputError)
      const error = await fetchCustomAttributes(
        apiService,
        "test-org",
        "spans",
      ).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Internal server error");
    });

    it("should re-throw 502 errors", async () => {
      mswServer.use(
        http.get("https://sentry.io/api/0/organizations/test-org/tags/", () => {
          return HttpResponse.json({ detail: "Bad gateway" }, { status: 502 });
        }),
      );

      const error = await fetchCustomAttributes(
        apiService,
        "test-org",
        "errors",
      ).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Bad gateway");
    });
  });

  describe("network errors", () => {
    it("should re-throw network errors to be captured by Sentry", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          () => {
            // Simulate network error by throwing
            throw new Error("Network error: ETIMEDOUT");
          },
        ),
      );

      await expect(
        fetchCustomAttributes(apiService, "test-org", "spans"),
      ).rejects.toThrow("Network error: ETIMEDOUT");
    });
  });

  describe("successful responses", () => {
    it("should return attributes for spans dataset", async () => {
      // Mock with separate string and number queries as the real API does
      // The API client makes two separate calls with attributeType parameter
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          ({ request }) => {
            const url = new URL(request.url);
            const attributeType = url.searchParams.get("attributeType");
            const itemType = url.searchParams.get("itemType");

            // Validate the request has expected parameters
            if (!attributeType || !itemType) {
              return HttpResponse.json(
                { detail: "Missing required parameters" },
                { status: 400 },
              );
            }

            if (attributeType === "string") {
              return HttpResponse.json([
                { key: "span.op", name: "Operation" },
                { key: "sentry:internal", name: "Internal" }, // Should be filtered
              ]);
            }
            if (attributeType === "number") {
              return HttpResponse.json([
                { key: "span.duration", name: "Duration" },
              ]);
            }
            return HttpResponse.json([]);
          },
        ),
      );

      const result = await fetchCustomAttributes(
        apiService,
        "test-org",
        "spans",
      );

      expect(result).toEqual({
        attributes: {
          "span.op": "Operation",
          "span.duration": "Duration",
        },
        fieldTypes: {
          "span.op": "string",
          "span.duration": "number",
        },
      });
    });

    it("should return attributes for errors dataset", async () => {
      mswServer.use(
        http.get("https://sentry.io/api/0/organizations/test-org/tags/", () => {
          return HttpResponse.json([
            { key: "browser", name: "Browser", totalValues: 10 },
            { key: "sentry:user", name: "User", totalValues: 5 }, // Should be filtered
            { key: "environment", name: "Environment", totalValues: 3 },
          ]);
        }),
      );

      const result = await fetchCustomAttributes(
        apiService,
        "test-org",
        "errors",
      );

      expect(result).toEqual({
        attributes: {
          browser: "Browser",
          environment: "Environment",
        },
        fieldTypes: {},
      });
    });
  });
});
