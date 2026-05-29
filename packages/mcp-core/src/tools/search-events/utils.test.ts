import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import {
  createDatasetAttributesTool,
  fetchCustomAttributes,
  formatEventValue,
  formatKnownUserValue,
  looksLikeSentrySearchSyntax,
} from "./utils";
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

    it("should include geo summaries for known user objects", () => {
      const user = {
        id: "3c7631c0121d40e79e2f992ff5cf7671",
        geo: {
          country_code: "US",
          region: "United States",
        },
      };

      expect(formatKnownUserValue(user, { includeGeo: true })).toContain(
        "geo=US, United States",
      );
    });

    it("should omit geo summaries for known user objects when requested", () => {
      const user = {
        id: "3c7631c0121d40e79e2f992ff5cf7671",
        geo: {
          country_code: "US",
          region: "United States",
        },
      };

      expect(formatKnownUserValue(user, { includeGeo: false })).toBe(
        "id=3c7631c0121d40e79e2f992ff5cf7671",
      );
    });

    it("should omit summary text for geo-only known users", () => {
      const user = {
        geo: {
          country_code: "US",
          region: "United States",
        },
      };

      expect(formatKnownUserValue(user, { includeGeo: false })).toBeNull();
    });

    it("should NOT apply user formatting to objects with only id", () => {
      const obj = { id: "abc", type: "transaction", description: "GET /api" };
      const result = formatEventValue(obj);
      // Should fall through to JSON, preserving all fields
      expect(result).toContain("type");
      expect(result).toContain("transaction");
      expect(result).toContain("description");
    });

    it("should NOT apply user formatting to non-user objects with geo", () => {
      const obj = {
        method: "GET",
        path: "/api/0/issues/",
        geo: {
          country_code: "US",
        },
      };

      const result = formatEventValue(obj);
      expect(result).toContain('"method":"GET"');
      expect(result).toContain('"path":"/api/0/issues/"');
      expect(result).toContain('"country_code":"US"');
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

describe("search query helpers", () => {
  it("should detect structured Sentry search syntax", () => {
    expect(looksLikeSentrySearchSyntax("vpn connections from China")).toBe(
      false,
    );
    expect(
      looksLikeSentrySearchSyntax(
        'transaction:"VPN connections" tags[type]:Unified tags[country]:CN',
      ),
    ).toBe(true);
    expect(looksLikeSentrySearchSyntax("span.op:http.client")).toBe(true);
    expect(looksLikeSentrySearchSyntax("http.status_code:500")).toBe(true);
    expect(looksLikeSentrySearchSyntax("customer:acme")).toBe(true);
    expect(looksLikeSentrySearchSyntax('!transaction:"healthcheck"')).toBe(
      true,
    );
  });

  it("should ignore common natural language colon patterns", () => {
    expect(looksLikeSentrySearchSyntax("open http://example.com")).toBe(false);
    expect(looksLikeSentrySearchSyntax("started at 10:30")).toBe(false);
    expect(looksLikeSentrySearchSyntax("Note: show slow spans")).toBe(false);
    expect(looksLikeSentrySearchSyntax("ERROR: service is down")).toBe(false);
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

    it("should return attributes for metrics dataset", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          ({ request }) => {
            const url = new URL(request.url);
            const attributeType = url.searchParams.get("attributeType");
            const itemType = url.searchParams.get("itemType");

            expect(itemType).toBe("tracemetrics");

            if (attributeType === "string") {
              return HttpResponse.json([
                { key: "metric.name", name: "Metric Name" },
                { key: "metric.type", name: "Metric Type" },
              ]);
            }

            if (attributeType === "number") {
              return HttpResponse.json([
                { key: "value", name: "Metric Value" },
              ]);
            }

            return HttpResponse.json([]);
          },
        ),
      );

      const result = await fetchCustomAttributes(
        apiService,
        "test-org",
        "metrics",
      );

      expect(result).toEqual({
        attributes: {
          "metric.name": "Metric Name",
          "metric.type": "Metric Type",
          value: "Metric Value",
        },
        fieldTypes: {
          "metric.name": "string",
          "metric.type": "string",
          value: "number",
        },
      });
    });

    it("should pass targeted trace item attribute filters through to Sentry", async () => {
      const requests: URLSearchParams[] = [];

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
          ({ request }) => {
            const url = new URL(request.url);
            requests.push(url.searchParams);

            const attributeType = url.searchParams.get("attributeType");
            if (attributeType === "string") {
              return HttpResponse.json([
                {
                  key: "tags[type]",
                  name: "type",
                  attributeType: "string",
                },
              ]);
            }
            if (attributeType === "number") {
              return HttpResponse.json([
                {
                  key: "tags[sequence,number]",
                  name: "sequence",
                  attributeType: "number",
                },
              ]);
            }
            if (attributeType === "boolean") {
              return HttpResponse.json([
                {
                  key: "tags[enabled,boolean]",
                  name: "enabled",
                  attributeType: "boolean",
                },
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
        "123",
        { statsPeriod: "7d" },
        {
          attributeTypes: ["string", "number", "boolean"],
          substringMatch: "tags[",
          query: 'transaction:"VPN connections"',
        },
      );

      expect(requests).toHaveLength(3);
      expect(
        requests.map((params) => params.get("attributeType")).sort(),
      ).toEqual(["boolean", "number", "string"]);
      for (const params of requests) {
        expect(params.get("itemType")).toBe("spans");
        expect(params.get("project")).toBe("123");
        expect(params.get("statsPeriod")).toBe("7d");
        expect(params.get("substringMatch")).toBe("tags[");
        expect(params.get("query")).toBe('transaction:"VPN connections"');
      }
      expect(result).toEqual({
        attributes: {
          "tags[type]": "type",
          "tags[sequence,number]": "sequence",
          "tags[enabled,boolean]": "enabled",
        },
        fieldTypes: {
          "tags[type]": "string",
          "tags[sequence,number]": "number",
          "tags[enabled,boolean]": "boolean",
        },
      });
    });
  });
});

describe("createDatasetAttributesTool — should not depend on the private validate endpoint", () => {
  let apiService: SentryApiService;
  let tool: ReturnType<typeof createDatasetAttributesTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logging, "logWarn").mockImplementation(() => {});
    apiService = new SentryApiService({ accessToken: "test-token" });
    tool = createDatasetAttributesTool({
      apiService,
      organizationSlug: "test-org",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mswServer.resetHandlers();
  });

  // The validate endpoint does not currently validate custom attributes and
  // will probably be replaced with a GET version that does not require
  // org:write scope. The MCP should never call it — verification of custom
  // attribute existence belongs entirely on the public GET endpoint.
  it("verifies custom attributes via the public GET endpoint, never the private POST validate endpoint", async () => {
    const validateCalls = vi.fn();
    mswServer.use(
      http.post(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/validate/",
        () => {
          validateCalls();
          return HttpResponse.json({ attributes: {} });
        },
      ),
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const attributeType = new URL(request.url).searchParams.get(
            "attributeType",
          );
          return HttpResponse.json(
            attributeType === "string"
              ? [{ key: "tags[foo]", name: "tags[foo]" }]
              : [],
          );
        },
      ),
    );

    const executeOptions = { toolCallId: "test", messages: [] } as any;
    const response = await tool.execute!({ dataset: "spans" }, executeOptions);

    expect(validateCalls).not.toHaveBeenCalled();
    expect(response).toHaveProperty("result");
    const result = (response as { result: string }).result;
    expect(result).toContain("tags[foo]");
  });

  // Regression guard: the spans dataset alone has 56 static fields (9 base +
  // 47 dataset-specific). Earlier versions concatenated static and custom
  // attributes into a single sliced list, which silently dropped every
  // custom attribute for spans. Custom attributes must always surface in
  // their own dedicated section, independent of the static-field cap.
  it("surfaces custom attributes for spans even though static fields exceed the output cap", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        ({ request }) => {
          const attributeType = new URL(request.url).searchParams.get(
            "attributeType",
          );
          return HttpResponse.json(
            attributeType === "string"
              ? [{ key: "tags[foo]", name: "tags[foo]" }]
              : [],
          );
        },
      ),
    );

    const executeOptions = { toolCallId: "test", messages: [] } as any;
    const response = await tool.execute!(
      { dataset: "spans", substringMatch: "tags[foo]" },
      executeOptions,
    );

    expect(response).toHaveProperty("result");
    const result = (response as { result: string }).result;
    // Must appear under the dedicated Custom Attributes heading, not in
    // some incidental slot like Field Types or Example Queries.
    expect(result).toMatch(/Custom Attributes[^\n]*:\s*\n- tags\[foo\]/);
  });

  // Built-in fields are known from static config. Verifying one (the prompt
  // tells the agent to pass an exact field name as substringMatch) must not
  // hit the trace-items attributes endpoint — that network round-trip is pure
  // overhead and, repeated per built-in field, is what bloated discovery-heavy
  // agent turns into multi-second failures.
  it("verifies a built-in field from static config without calling the attributes endpoint", async () => {
    const attributesCalls = vi.fn();
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/test-org/trace-items/attributes/",
        () => {
          attributesCalls();
          return HttpResponse.json([]);
        },
      ),
    );

    const executeOptions = { toolCallId: "test", messages: [] } as any;
    // span.duration is a built-in span field (and a known numeric field).
    const response = await tool.execute!(
      { dataset: "spans", substringMatch: "span.duration" },
      executeOptions,
    );

    expect(attributesCalls).not.toHaveBeenCalled();
    expect(response).toHaveProperty("result");
    const result = (response as { result: string }).result;
    // The field is confirmed as built-in, and the custom-attribute lookup is
    // explicitly reported as skipped rather than silently empty.
    expect(result).toContain("span.duration");
    expect(result).toMatch(/skipped — "span\.duration" is a built-in field/);
  });
});
