import { describe, expect, it } from "vitest";
import { getToolCalls } from "./mcpToolCallHarness";

describe("getToolCalls", () => {
  it("keeps tool calls from every step when top-level calls only include the last step", () => {
    const toolCalls = getToolCalls({
      toolCalls: [
        {
          toolName: "execute_tool",
          input: {
            name: "get_issue",
          },
        },
      ],
      steps: [
        {
          toolCalls: [
            {
              toolName: "search_tools",
              input: {
                query: "get issue",
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolName: "execute_tool",
              input: {
                name: "get_issue",
              },
            },
          ],
        },
      ],
    });

    expect(toolCalls).toEqual([
      {
        name: "search_tools",
        arguments: {
          query: "get issue",
        },
      },
      {
        name: "execute_tool",
        arguments: {
          name: "get_issue",
        },
      },
    ]);
  });

  it("falls back to top-level calls when step calls are unavailable", () => {
    expect(
      getToolCalls({
        toolCalls: [
          {
            toolName: "execute_tool",
            input: {
              name: "get_trace_details",
            },
          },
        ],
      }),
    ).toEqual([
      {
        name: "execute_tool",
        arguments: {
          name: "get_trace_details",
        },
      },
    ]);
  });
});
