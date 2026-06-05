import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import { tool, type ToolExecutionOptions } from "ai";
import { toolCalls as collectToolCalls } from "vitest-evals";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { preferRuntimeToolCapture } from "./mcpToolCallHarness";

function createToolOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  };
}

describe("preferRuntimeToolCapture", () => {
  it("removes raw AI SDK steps so the harness uses runtime-captured tool calls", () => {
    const result = preferRuntimeToolCapture({
      text: "Issue summary",
      steps: [
        {
          toolCalls: [
            {
              toolName: "execute_tool",
              input: {
                name: "get_issue_details",
              },
            },
          ],
        },
      ],
      totalUsage: {
        inputTokens: 10,
        outputTokens: 5,
      },
    });

    expect(result).toEqual({
      text: "Issue summary",
      steps: undefined,
      totalUsage: {
        inputTokens: 10,
        outputTokens: 5,
      },
    });
  });

  it("preserves the runtime-captured sequence when raw steps only expose the last call", async () => {
    const harness = aiSdkHarness({
      name: "runtime-capture-test",
      tools: {
        search_tools: tool({
          inputSchema: z.object({
            query: z.string(),
          }),
          execute: async () => ({ name: "get_issue_details" }),
        }),
        execute_tool: tool({
          inputSchema: z.object({
            name: z.string(),
          }),
          execute: async () => ({ ok: true }),
        }),
      },
      run: async ({ runtime }) => {
        if (!runtime.tools.search_tools.execute) {
          throw new Error("search_tools execute function is missing");
        }
        if (!runtime.tools.execute_tool.execute) {
          throw new Error("execute_tool execute function is missing");
        }

        await runtime.tools.search_tools.execute(
          { query: "issue" },
          createToolOptions("call_1"),
        );
        await runtime.tools.execute_tool.execute(
          { name: "get_issue_details" },
          createToolOptions("call_2"),
        );

        return preferRuntimeToolCapture({
          text: "Issue summary",
          steps: [
            {
              toolCalls: [
                {
                  toolCallId: "call_2",
                  toolName: "execute_tool",
                  input: {
                    name: "get_issue_details",
                  },
                },
              ],
            },
          ],
          totalUsage: {
            inputTokens: 10,
            outputTokens: 5,
          },
        });
      },
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
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      toolCalls: 2,
    });
  });
});
