import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SentryApiService } from "../api-client";

vi.mock("../logging", () => ({
  logError: vi.fn(),
}));

// Import the actual function - no mocking needed since build runs first
import { lookupOtelSemantics } from "./lookup-otel-semantics";

describe("otel-semantics-lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockApiService = {} as SentryApiService;

  describe("lookupOtelSemantics", () => {
    it("should return namespace information for valid namespace", async () => {
      const result = await lookupOtelSemantics(
        "gen_ai",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result).toContain("# OpenTelemetry Semantic Conventions: gen_ai");
      expect(result).toContain("## Attributes");
      expect(result).toContain("`gen_ai.usage.input_tokens`");
      expect(result).toContain("`gen_ai.usage.output_tokens`");
      expect(result).toContain("- **Type:**");
      expect(result).toContain("- **Description:**");
    });

    it("should handle namespace with underscore and dash interchangeably", async () => {
      const result1 = await lookupOtelSemantics(
        "gen_ai",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );
      const result2 = await lookupOtelSemantics(
        "gen-ai",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result1).toBe(result2);
    });

    it("should filter attributes by search term", async () => {
      const result = await lookupOtelSemantics(
        "http",
        "method",
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result).toContain("matching)");
      expect(result).toContain("`http.request.method`");
    });

    it("should show custom namespace note for mcp", async () => {
      const result = await lookupOtelSemantics(
        "mcp",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result).toContain("**Note:** This is a custom namespace");
    });

    it("should handle invalid namespace", async () => {
      const result = await lookupOtelSemantics(
        "totally_invalid_namespace_that_does_not_exist",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result).toContain(
        "Namespace 'totally_invalid_namespace_that_does_not_exist' not found",
      );
    });

    it("should suggest similar namespaces", async () => {
      const result = await lookupOtelSemantics(
        "gen",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result).toContain("Did you mean:");
      expect(result).toContain("gen_ai");
    });
  });
});
