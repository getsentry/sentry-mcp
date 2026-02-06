import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import { fetchCustomAttributes, formatEventValue } from "./utils";
import { SentryApiService } from "../../api-client";
import * as logging from "../../telem/logging";

describe("formatEventValue", () => {
  describe("primitives", () => {
    it("should return 'null' for null", () => {
      expect(formatEventValue(null)).toBe("null");
    });

    it("should return 'undefined' for undefined", () => {
      expect(formatEventValue(undefined)).toBe("undefined");
    });

    it("should return string values as-is", () => {
      expect(formatEventValue("hello")).toBe("hello");
    });

    it("should stringify numbers", () => {
      expect(formatEventValue(42)).toBe("42");
      expect(formatEventValue(0)).toBe("0");
      expect(formatEventValue(-1.5)).toBe("-1.5");
    });

    it("should stringify booleans", () => {
      expect(formatEventValue(true)).toBe("true");
      expect(formatEventValue(false)).toBe("false");
    });
  });

  describe("strings", () => {
    it("should collapse whitespace", () => {
      expect(formatEventValue("hello   world")).toBe("hello world");
      expect(formatEventValue("  leading")).toBe("leading");
      expect(formatEventValue("trailing  ")).toBe("trailing");
    });

    it("should truncate long strings", () => {
      const long = "a".repeat(300);
      const result = formatEventValue(long);
      expect(result.length).toBe(200);
      expect(result).toMatch(/\.\.\.$/);
    });

    it("should respect custom maxLength", () => {
      const result = formatEventValue("a".repeat(50), { maxLength: 20 });
      expect(result.length).toBe(20);
      expect(result).toMatch(/\.\.\.$/);
    });
  });

  describe("arrays", () => {
    it("should format empty arrays", () => {
      expect(formatEventValue([])).toBe("[]");
    });

    it("should format tag-pair arrays", () => {
      const tags = [
        { key: "os", value: "iOS 17" },
        { key: "device", value: "iPhone15,3" },
      ];
      expect(formatEventValue(tags)).toBe("os=iOS 17, device=iPhone15,3");
    });

    it("should format primitive arrays", () => {
      expect(formatEventValue([1, 2, 3])).toBe("1, 2, 3");
      expect(formatEventValue(["a", "b", "c"])).toBe("a, b, c");
    });

    it("should JSON-serialize mixed arrays", () => {
      const result = formatEventValue([1, "two", { key: "val" }]);
      expect(result).toContain("1");
      expect(result).toContain("two");
      expect(result).not.toContain("[object Object]");
    });
  });

  describe("objects", () => {
    it("should format user objects with identity fields", () => {
      const user = {
        id: "user-123",
        email: "foo@example.com",
        ip_address: "10.0.0.1",
      };
      const result = formatEventValue(user);
      expect(result).toContain("id=user-123");
      expect(result).toContain("email=foo@example.com");
      expect(result).toContain("ip_address=10.0.0.1");
    });

    it("should NOT apply user formatting to objects with only id", () => {
      const obj = { id: "abc", type: "transaction", description: "GET /api" };
      const result = formatEventValue(obj);
      // Should fall through to JSON, preserving all fields
      expect(result).toContain("type");
      expect(result).toContain("transaction");
      expect(result).toContain("description");
    });

    it("should format tag-pair objects", () => {
      const tag = { key: "browser", value: "Chrome 120" };
      expect(formatEventValue(tag)).toBe("browser=Chrome 120");
    });

    it("should JSON-serialize arbitrary objects", () => {
      const obj = { foo: "bar", count: 42 };
      const result = formatEventValue(obj);
      expect(result).toContain("foo");
      expect(result).toContain("bar");
      expect(result).not.toContain("[object Object]");
    });

    it("should handle circular references", () => {
      const obj: Record<string, unknown> = { type: "test" };
      obj.self = obj;
      const result = formatEventValue(obj);
      expect(result).toContain("[Circular]");
      expect(result).not.toContain("[object Object]");
    });
  });

  describe("truncation", () => {
    it("should truncate objects exceeding maxLength", () => {
      const obj = { key: "a".repeat(300) };
      const result = formatEventValue(obj, { maxLength: 50 });
      expect(result.length).toBe(50);
      expect(result).toMatch(/\.\.\.$/);
    });

    it("should handle maxLength <= 3", () => {
      const result = formatEventValue("abcdef", { maxLength: 3 });
      expect(result).toBe("abc");
    });
  });
});

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
