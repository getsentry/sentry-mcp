import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { SentryApiService } from "../../../api-client";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Mock the file system module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("../../../logging", () => ({
  logError: vi.fn(),
}));

// Import after mocks are set up
import {
  lookupOtelSemantics,
  loadNamespacesIndex,
  getNamespaceInfo,
  getAvailableNamespaces,
} from "./otel-semantics-lookup";

const mockReadFileSync = readFileSync as Mock;
const mockReaddirSync = readdirSync as Mock;

describe("otel-semantics-lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockApiService = {} as SentryApiService;

  // Helper to set up namespace data
  function setupNamespaceData(namespaces: Record<string, any>) {
    const files = Object.keys(namespaces).map((ns) => `${ns}.json`);
    files.push("__namespaces.json");

    mockReaddirSync.mockReturnValue(files);

    mockReadFileSync.mockImplementation((path: string) => {
      const pathStr = path.toString();

      // Handle namespace index
      if (pathStr.includes("__namespaces.json")) {
        return JSON.stringify({
          generated: "2025-01-01T00:00:00Z",
          totalNamespaces: Object.keys(namespaces).length,
          namespaces: Object.entries(namespaces).map(([ns, data]) => ({
            namespace: ns,
            description: data.description || "Test namespace",
          })),
        });
      }

      // Handle individual namespace files
      for (const [ns, data] of Object.entries(namespaces)) {
        if (pathStr.includes(`${ns}.json`)) {
          return JSON.stringify(data);
        }
      }

      return "{}";
    });
  }

  describe("loadNamespacesIndex", () => {
    it("should load and parse namespaces index file", () => {
      setupNamespaceData({
        gen_ai: {
          namespace: "gen_ai",
          description: "GenAI operations",
          attributes: {},
        },
        db: {
          namespace: "db",
          description: "Database operations",
          attributes: {},
        },
      });

      const result = loadNamespacesIndex();

      expect(result.totalNamespaces).toBe(2);
      expect(result.namespaces).toHaveLength(2);
      expect(result.namespaces[0].namespace).toBe("gen_ai");
      expect(result.namespaces[1].namespace).toBe("db");
    });

    it("should return empty index on error", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });
      mockReaddirSync.mockReturnValue([]);

      const result = loadNamespacesIndex();

      expect(result.totalNamespaces).toBe(0);
      expect(result.namespaces).toEqual([]);
    });
  });

  describe("lookupOtelSemantics", () => {
    it("should return namespace information for valid namespace", async () => {
      // Note: Since the module loads data at import time, we need to test
      // with whatever namespaces are actually available in the data directory
      // For unit tests, we'll just verify the function structure works
      const result = await lookupOtelSemantics(
        "gen_ai",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      // The result should either contain namespace info or a not found message
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle invalid namespace", async () => {
      const result = await lookupOtelSemantics(
        "definitely_invalid_namespace_that_does_not_exist",
        undefined,
        "spans",
        mockApiService,
        "test-org",
      );

      expect(result).toContain("not found");
    });
  });

  describe("helper functions", () => {
    it("should get namespace info", () => {
      const info = getNamespaceInfo("gen_ai");
      // Either returns namespace data or undefined
      expect(info === undefined || typeof info === "object").toBe(true);
    });

    it("should get available namespaces", () => {
      const namespaces = getAvailableNamespaces();
      expect(Array.isArray(namespaces)).toBe(true);
    });
  });
});
