import { describe, expect, it } from "vitest";
import {
  formatToolCall,
  formatToolCallInstruction,
} from "./tool-call-formatting";

describe("tool call formatting", () => {
  it("formats direct calls when a tool is top-level in the current mode", () => {
    expect(
      formatToolCallInstruction({
        toolName: "search_events",
        arguments: {
          organizationSlug: "my-org",
          query: "level:error",
        },
        experimentalMode: true,
      }),
    ).toBe(
      "Use the Sentry tool `search_events(organizationSlug='my-org', query='level:error')`",
    );
  });

  it("formats catalog guidance when a tool is not top-level in the current mode", () => {
    expect(
      formatToolCallInstruction({
        toolName: "get_doc",
        arguments: {
          path: "/platforms/javascript/guides/nextjs.md",
        },
        experimentalMode: true,
      }),
    ).toBe(
      'Use the Sentry tool `get_doc`: search `search_tools(query=\'get_doc\')`, then call `execute_tool` with name `get_doc` and arguments `{"path":"/platforms/javascript/guides/nextjs.md"}`',
    );
  });

  it("formats purpose text before catalog gateway steps", () => {
    expect(
      formatToolCallInstruction({
        toolName: "find_releases",
        arguments: {
          organizationSlug: "my-org",
        },
        experimentalMode: true,
        availableToolNames: new Set([
          "find_releases",
          "search_tools",
          "execute_tool",
        ]),
        purpose: "to list releases and their details",
      }),
    ).toBe(
      'Use the Sentry tool `find_releases` to list releases and their details: search `search_tools(query=\'find_releases\')`, then call `execute_tool` with name `find_releases` and arguments `{"organizationSlug":"my-org"}`',
    );
  });

  it("does not append purpose text to fallback guidance", () => {
    expect(
      formatToolCallInstruction({
        toolName: "find_releases",
        experimentalMode: true,
        availableToolNames: new Set(["search_tools", "execute_tool"]),
        fallbackInstruction: "Release listing is not available",
        purpose: "to list releases and their details",
      }),
    ).toBe("Release listing is not available");
  });

  it("does not format non-top-level stable tools as direct calls", () => {
    expect(
      formatToolCallInstruction({
        toolName: "get_snapshot_image",
        arguments: {
          organizationSlug: "my-org",
          snapshotId: "123",
          imageIdentifier: "login.png",
        },
        experimentalMode: false,
      }),
    ).toBe(
      "The Sentry tool `get_snapshot_image` is not available in this session",
    );
  });

  it("uses fallback guidance for unavailable tools", () => {
    expect(
      formatToolCallInstruction({
        toolName: "find_releases",
        arguments: {
          organizationSlug: "my-org",
        },
        experimentalMode: true,
        availableToolNames: new Set([
          "get_sentry_resource",
          "search_tools",
          "execute_tool",
        ]),
        fallbackInstruction: "Release listing is not available",
      }),
    ).toBe("Release listing is not available");
  });

  it("uses catalog guidance only when the target tool is available", () => {
    expect(
      formatToolCallInstruction({
        toolName: "find_releases",
        arguments: {
          organizationSlug: "my-org",
        },
        experimentalMode: true,
        availableToolNames: new Set([
          "find_releases",
          "search_tools",
          "execute_tool",
        ]),
      }),
    ).toBe(
      'Use the Sentry tool `find_releases`: search `search_tools(query=\'find_releases\')`, then call `execute_tool` with name `find_releases` and arguments `{"organizationSlug":"my-org"}`',
    );
  });

  it("escapes arguments in direct call examples", () => {
    expect(
      formatToolCall({
        toolName: "search_issues",
        arguments: {
          organizationSlug: "my\\org",
          query: "message:'oops'",
        },
      }),
    ).toBe(
      "search_issues(organizationSlug='my\\\\org', query='message:\\'oops\\'')",
    );
  });

  it("formats nested JSON-compatible arguments", () => {
    expect(
      formatToolCall({
        toolName: "search_events",
        arguments: {
          fields: ["title", "count()"],
          options: { referrer: "mcp" },
        },
      }),
    ).toBe(
      'search_events(fields=["title","count()"], options={"referrer":"mcp"})',
    );
  });
});
