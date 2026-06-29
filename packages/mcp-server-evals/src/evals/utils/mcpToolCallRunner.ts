import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { generateText, stepCountIs } from "ai";
import { getEvalModelConfig } from "./model";
import { createMockMcpTransport } from "./mcpTransport";

function toToolCall(call: { toolName: string; input: unknown }) {
  const input =
    call.input && typeof call.input === "object" && !Array.isArray(call.input)
      ? (call.input as Record<string, unknown>)
      : {};

  return {
    name: call.toolName,
    arguments: input,
  };
}

/** Creates the MCP-backed task runner used by catalog tool-call evals. */
export function McpToolCallTaskRunner(maxSteps = 6) {
  return async function McpToolCallTaskRunner(input: string) {
    const modelConfig = getEvalModelConfig();

    const client = await experimental_createMCPClient({
      transport: createMockMcpTransport(),
    });

    try {
      const tools = await client.tools();
      const result = await generateText({
        model: modelConfig.model,
        tools,
        system: [
          "You are a Sentry assistant with access to Sentry MCP tools.",
          "Use the available MCP tools to answer the user request.",
          "When a request needs a catalog operation that is not directly exposed, discover the appropriate catalog tool and then execute it.",
          "When a directly exposed tool satisfies the request, call it directly.",
        ].join("\n"),
        prompt: input,
        stopWhen: stepCountIs(maxSteps),
        experimental_telemetry: {
          isEnabled: true,
          functionId: "catalog_tool_behavior_eval",
        },
        providerOptions: modelConfig.providerOptions,
      });

      return {
        result: result.text,
        toolCalls: result.steps.flatMap((step) =>
          step.toolCalls.map(toToolCall),
        ),
      };
    } finally {
      await client.close();
    }
  };
}
