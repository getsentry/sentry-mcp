import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import {
  dynamicTool,
  type LanguageModelUsage,
  type ToolExecutionOptions,
} from "ai";
import {
  toolCalls as collectToolCalls,
  type ToolCallRecord,
} from "vitest-evals";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  captureMcpToolCalls,
  createMcpToolCallRun,
} from "./mcpToolCallHarness";

function createToolOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  };
}

function createUsage(): LanguageModelUsage {
  return {
    inputTokens: 10,
    inputTokenDetails: {
      noCacheTokens: 10,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: 5,
    outputTokenDetails: {
      textTokens: 5,
      reasoningTokens: undefined,
    },
    totalTokens: 15,
  };
}

describe("captureMcpToolCalls", () => {
  it("captures dynamic MCP tool execution before delegating", async () => {
    const capturedToolCalls: ToolCallRecord[] = [];
    const tools = captureMcpToolCalls(
      {
        search_tools: dynamicTool({
          inputSchema: z.object({
            query: z.string(),
          }),
          execute: async (input) => ({
            name: "get_issue_details",
            input,
          }),
        }),
      },
      capturedToolCalls,
    );

    const result = await tools.search_tools.execute?.(
      { query: "issue" },
      createToolOptions("call_1"),
    );

    expect(result).toEqual({
      name: "get_issue_details",
      input: {
        query: "issue",
      },
    });
    expect(capturedToolCalls).toMatchObject([
      {
        id: "call_1",
        name: "search_tools",
        arguments: {
          query: "issue",
        },
        result: {
          name: "get_issue_details",
          input: {
            query: "issue",
          },
        },
      },
    ]);
    expect(capturedToolCalls[0].startedAt).toEqual(expect.any(String));
    expect(capturedToolCalls[0].finishedAt).toEqual(expect.any(String));
    expect(capturedToolCalls[0].durationMs).toEqual(expect.any(Number));
  });

  it("records tool errors before rethrowing", async () => {
    const capturedToolCalls: ToolCallRecord[] = [];
    const tools = captureMcpToolCalls(
      {
        execute_tool: dynamicTool({
          inputSchema: z.object({
            name: z.string(),
          }),
          execute: async () => {
            throw new Error("tool failed");
          },
        }),
      },
      capturedToolCalls,
    );

    await expect(
      tools.execute_tool.execute?.(
        { name: "get_issue_details" },
        createToolOptions("call_2"),
      ),
    ).rejects.toThrow("tool failed");

    expect(capturedToolCalls).toMatchObject([
      {
        id: "call_2",
        name: "execute_tool",
        arguments: {
          name: "get_issue_details",
        },
        error: {
          type: "Error",
          message: "tool failed",
        },
      },
    ]);
  });
});

describe("createMcpToolCallRun", () => {
  it("preserves the captured sequence when raw AI SDK steps only expose the last call", async () => {
    const capturedToolCalls: ToolCallRecord[] = [
      {
        id: "call_1",
        name: "search_tools",
        arguments: {
          query: "issue",
        },
      },
      {
        id: "call_2",
        name: "execute_tool",
        arguments: {
          name: "get_issue_details",
        },
      },
    ];
    const result = {
      text: "Issue summary",
      steps: [
        {
          model: {
            provider: "openai",
            modelId: "gpt-4o",
          },
          toolCalls: [
            {
              toolCallId: "call_2",
              toolName: "execute_tool",
              input: {
                name: "get_issue_details",
              },
            },
          ],
          usage: createUsage(),
        },
      ],
      totalUsage: createUsage(),
    };
    const harness = aiSdkHarness({
      name: "mcp-tool-call-test",
      run: async () =>
        createMcpToolCallRun("Explain an issue", result, capturedToolCalls),
    });

    const run = await harness.run("Explain an issue", {
      metadata: {},
      artifacts: {},
      setArtifact: () => {},
    });

    expect(collectToolCalls(run.session).map(({ name }) => name)).toEqual([
      "search_tools",
      "execute_tool",
    ]);
    expect(run.usage).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      toolCalls: 2,
    });
    expect(
      (run.traces ?? [])
        .flatMap((trace) => trace.spans)
        .filter((span) => span.kind === "tool")
        .map((span) => span.name),
    ).toEqual(["search_tools", "execute_tool"]);
  });
});
