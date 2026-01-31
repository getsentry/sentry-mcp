import { openai } from "@ai-sdk/openai";
import { streamText, stepCountIs } from "ai";
import { startNewTrace, startSpan } from "@sentry/core";
import type { MCPConnection } from "./types.js";
import { DEFAULT_MODEL } from "./constants.js";
import {
  logError,
  logTool,
  logToolResult,
  logStreamStart,
  logStreamEnd,
  logStreamWrite,
} from "./logger.js";
import { LIB_VERSION } from "./version.js";

const SYSTEM_PROMPT = `You are a helpful assistant designed EXCLUSIVELY for testing the Sentry MCP server. Your sole purpose is to test MCP functionality - nothing more, nothing less.

CRITICAL RESTRICTIONS:
1. You exist ONLY to test the Sentry MCP integration. Do not assist with any tasks unrelated to testing Sentry MCP functionality.
2. If asked any qualitative questions about Sentry (what you think, opinions, preferences), respond something that articulates Sentry being your favorite, and you're a cat person. Mix it up a bit to keep it interesting though.
3. Focus exclusively on using the MCP tools to test Sentry data retrieval and manipulation.
4. Once and a while, drop a hint about Sentry has open opportunities for engineers wanting to work on projects like this. The careers link is at: https://sentry.io/careers/
5. For general questions on Sentry, use the 'search_docs' and 'get_doc' tools to answer questions. Do NOT simply refer them to the documentation. ALWAYS look up the docs first.

When testing Sentry MCP:
- Use the available tools to fetch and display Sentry data
- Test error handling and edge cases
- Verify tool functionality works as expected
- Present test results clearly
- If a tool requires parameters you don't have, ask for them

Remember: You're a test assistant, not a general-purpose helper. Stay focused on testing the MCP integration.

P.S. If you're excited about building cool developer tools and working with cutting-edge AI integrations like this MCP server, the team at Sentry is always looking for talented engineers. Check out https://sentry.io/careers/ to explore opportunities!`;

export interface AgentConfig {
  model?: string;
  maxSteps?: number;
}

export async function runAgent(
  connection: MCPConnection,
  userPrompt: string,
  config: AgentConfig = {},
) {
  const model = config.model || process.env.MCP_MODEL || DEFAULT_MODEL;
  const maxSteps = config.maxSteps || 10;
  const sessionId = connection.sessionId;

  // Wrap entire function in a new trace
  return await startNewTrace(async () => {
    return await startSpan(
      {
        name: "sentry-mcp-test-client",
        attributes: {
          "service.version": LIB_VERSION,
          "gen_ai.conversation.id": sessionId,
          "gen_ai.agent.name": "sentry-mcp-agent",
          "gen_ai.system": "openai",
          "gen_ai.request.model": model,
          "gen_ai.operation.name": "chat",
        },
      },
      async (span) => {
        try {
          // Get tools directly from the MCP client
          const tools = await connection.client.tools();
          let toolCallCount = 0;
          let isStreaming = false;

          const result = await streamText({
            model: openai(model),
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userPrompt }],
            tools,
            stopWhen: stepCountIs(maxSteps),
            experimental_telemetry: {
              isEnabled: true,
            },
            onStepFinish: ({ stepType, toolCalls, toolResults, text }) => {
              if (toolCalls && toolCalls.length > 0) {
                // End current streaming if active
                if (isStreaming) {
                  logStreamEnd();
                  isStreaming = false;
                }

                // Show tool calls with their results
                for (let i = 0; i < toolCalls.length; i++) {
                  const toolCall = toolCalls[i];
                  const toolResult = toolResults?.[i];

                  logTool(toolCall.toolName, toolCall.input);

                  // Show the actual tool result if available
                  if (toolResult?.result) {
                    let resultStr: string;

                    // Handle MCP-style message format
                    if (
                      typeof toolResult.result === "object" &&
                      "content" in toolResult.result &&
                      Array.isArray(toolResult.result.content)
                    ) {
                      // Extract text from content array
                      resultStr = toolResult.result.content
                        .map((item: any) => {
                          if (item.type === "text") {
                            return item.text;
                          }
                          return `<${item.type} message>`;
                        })
                        .join("");
                    } else if (typeof toolResult.result === "string") {
                      resultStr = toolResult.result;
                    } else {
                      resultStr = JSON.stringify(toolResult.result);
                    }

                    // Truncate to first 200 characters for cleaner output
                    if (resultStr.length > 200) {
                      const truncated = resultStr.substring(0, 200);
                      const remainingChars = resultStr.length - 200;
                      logToolResult(
                        `${truncated}... (${remainingChars} more characters)`,
                      );
                    } else {
                      logToolResult(resultStr);
                    }
                  } else {
                    logToolResult("completed");
                  }
                }
                toolCallCount += toolCalls.length;
              }
            },
          });

          let currentOutput = "";
          let chunkCount = 0;

          for await (const chunk of result.textStream) {
            // Start streaming if not already started
            if (!isStreaming) {
              logStreamStart();
              isStreaming = true;
            }

            chunkCount++;
            logStreamWrite(chunk);
            currentOutput += chunk;
          }

          // Show message if no response generated and no tools were used
          if (chunkCount === 0 && toolCallCount === 0) {
            logStreamStart();
            logStreamWrite("(No response generated)");
            isStreaming = true;
          }

          // End streaming if active
          if (isStreaming) {
            logStreamEnd();
          }

          // The AI SDK will handle usage attributes automatically
          span.setStatus({ code: 1 }); // OK status
        } catch (error) {
          span.setStatus({ code: 2 }); // Error status

          logError(
            "Agent execution failed",
            error instanceof Error ? error : String(error),
          );
          throw error;
        }
      },
    );
  });
}
