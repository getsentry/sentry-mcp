import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mswServer, generateMockResponse, parseQuery } from "../index";

// Setup MSW server for tests
beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe("search-events mock data validation", () => {
  describe("parseQuery", () => {
    it("should parse error dataset queries correctly", () => {
      const query =
        "error.handled:false AND environment:production AND timestamp:-1h";
      const context = parseQuery(query, "errors");

      expect(context.filters.handled).toBe(false);
      expect(context.filters.environment).toBe("production");
      expect(context.timeRange.start).toBeDefined();
    });

    it("should parse log dataset queries correctly", () => {
      const query = "severity:error AND message:*database*";
      const context = parseQuery(query, "logs");

      expect(context.filters.severity).toBe("error");
      expect(context.filters.searchTerms).toContain("database");
    });

    it("should parse span dataset queries correctly", () => {
      const query = "span.op:db.query AND span.duration:>1000";
      const context = parseQuery(query, "spans");

      expect(context.filters.spanOp).toBe("db.query");
      expect(context.filters.minDuration).toBe(1000);
    });

    it("should handle quoted strings in queries", () => {
      const query = 'message:"database connection failed" AND level:error';
      const context = parseQuery(query, "errors");

      expect(context.filters.searchTerms).toContain(
        "database connection failed",
      );
      expect(context.filters.level).toBe("error");
    });

    it("should extract special search terms", () => {
      const query = "login failures with 401 errors";
      const context = parseQuery(query, "errors");

      expect(context.filters.searchTerms).toContain("login");
      expect(context.filters.searchTerms).toContain("401");
    });
  });

  describe("generateMockResponse", () => {
    it("should generate error responses with correct structure", () => {
      const response = generateMockResponse("errors", "error.handled:false", [
        "issue",
        "title",
        "project",
        "count()",
        "last_seen()",
      ]);

      expect(response.data).toBeDefined();
      expect(response.meta.dataset).toBe("errors");
      expect(Array.isArray(response.data)).toBe(true);

      if (response.data.length > 0) {
        const error = response.data[0];
        expect(error).toHaveProperty("issue");
        expect(error).toHaveProperty("title");
        expect(error["error.handled"]).toBe(false);
      }
    });

    it("should generate log responses with severity filtering", () => {
      const response = generateMockResponse("logs", "severity:error", [
        "timestamp",
        "message",
        "severity",
        "project",
      ]);

      expect(response.meta.dataset).toBe("logs");

      if (response.data.length > 0) {
        const log = response.data[0];
        expect(log.severity).toBe("error");
      }
    });

    it("should generate span responses with duration filtering", () => {
      const response = generateMockResponse(
        "spans",
        "span.op:http* AND span.duration:>5000",
        ["id", "span.op", "span.description", "span.duration", "transaction"],
      );

      expect(response.meta.dataset).toBe("spans");

      if (response.data.length > 0) {
        const span = response.data[0];
        expect(span["span.duration"]).toBeGreaterThan(5000);
        expect(span["span.op"]).toContain("http");
      }
    });

    it("should return empty results for non-matching queries", () => {
      const response = generateMockResponse(
        "errors",
        "error.type:NonExistentError",
        ["issue", "title"],
      );

      // Should return empty or very few results
      expect(response.data.length).toBeLessThanOrEqual(1);
    });

    it("should handle complex boolean queries", () => {
      const response = generateMockResponse(
        "errors",
        "(database OR timeout) AND level:error",
        ["issue", "title", "level"],
      );

      if (response.data.length > 0) {
        const error = response.data[0];
        expect(error.level).toBe("error");
        const title = error.title.toLowerCase();
        expect(title.includes("database") || title.includes("timeout")).toBe(
          true,
        );
      }
    });
  });

  describe("mock data consistency", () => {
    it("should generate consistent timestamps", () => {
      const response = generateMockResponse("logs", "", [
        "timestamp",
        "message",
      ]);

      if (response.data.length > 0) {
        for (const log of response.data) {
          expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
      }
    });

    it("should generate valid project slugs", () => {
      const response = generateMockResponse(
        "errors",
        "project:cloudflare-mcp",
        ["project", "title"],
      );

      if (response.data.length > 0) {
        for (const error of response.data) {
          expect(error.project).toBe("cloudflare-mcp");
        }
      }
    });

    it("should maintain field type consistency", () => {
      const response = generateMockResponse("spans", "", [
        "span.duration",
        "is_transaction",
      ]);

      expect(response.meta.fields["span.duration"]).toBe("duration");
      expect(response.meta.fields.is_transaction).toBe("boolean");
      expect(response.meta.units["span.duration"]).toBe("millisecond");
    });
  });
});
