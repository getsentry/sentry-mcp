import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type LanguageModel } from "ai";

const defaultModel = openai("gpt-4o");

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

export function McpToolCallTaskRunner(
  model: LanguageModel = defaultModel,
  maxSteps = 6,
) {
  return async function McpToolCallTaskRunner(input: string) {
    const transport = new Experimental_StdioMCPTransport({
      command: "pnpm",
      args: ["--filter", "@sentry/mcp-server-evals", "start"],
      env: {
        ...process.env,
        SENTRY_ACCESS_TOKEN: "mocked-access-token",
        SENTRY_HOST: "sentry.io",
      },
    });
    const client = await experimental_createMCPClient({ transport });

    try {
      const tools = await client.tools();
      const result = await generateText({
        model,
        tools,
        system: [
          "You are a Sentry assistant with access to Sentry MCP tools.",
          "Use search_tools before execute_tool when the needed Sentry operation is not directly listed as a tool.",
          "When search_tools returns a tool, call execute_tool with that returned tool name and arguments matching the returned schema.",
        ].join("\n"),
        prompt: input,
        stopWhen: stepCountIs(maxSteps),
        experimental_telemetry: {
          isEnabled: true,
          functionId: "catalog_tool_behavior_eval",
        },
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
