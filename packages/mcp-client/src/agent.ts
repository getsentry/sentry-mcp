import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import type { MCPConnection } from "./types.js";
import { getSystemPrompt } from "./prompts.js";
import { DEFAULT_MODEL } from "./constants.js";
import {
  logError,
  logTool,
  logToolResult,
  logStreamStart,
  logStreamEnd,
  logStreamWrite,
} from "./logger.js";

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

  // Get tools directly from the MCP client
  const tools = await connection.client.tools();
  let toolCallCount = 0;

  try {
    let isStreaming = false;

    const result = await streamText({
      model: anthropic(model),
      system: getSystemPrompt(),
      messages: [{ role: "user", content: userPrompt }],
      tools,
      maxSteps,
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

            logTool(toolCall.toolName, toolCall.args);

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
  } catch (error) {
    logError(
      "Agent execution failed",
      error instanceof Error ? error : String(error),
    );
    throw error;
  }
}
