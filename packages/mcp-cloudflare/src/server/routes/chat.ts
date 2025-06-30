import { Hono } from "hono";
import { openai } from "@ai-sdk/openai";
import { streamText, type ToolSet } from "ai";
import { experimental_createMCPClient } from "ai";
import type { Env } from "../types";
import { logError } from "@sentry/mcp-server/logging";
import type {
  ErrorResponse,
  ChatRequest,
  RateLimitResult,
} from "../types/chat";
import { executePromptHandler } from "../lib/mcp-prompts";
import { analyzeAuthError, getAuthErrorResponse } from "../utils/auth-errors";

type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

function createErrorResponse(errorResponse: ErrorResponse): ErrorResponse {
  return errorResponse;
}

export default new Hono<{ Bindings: Env }>().post("/", async (c) => {
  // Validate that we have an OpenAI API key
  if (!c.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not configured");
    return c.json(
      createErrorResponse({
        error: "AI service not configured",
        name: "AI_SERVICE_UNAVAILABLE",
      }),
      500,
    );
  }

  // Get the authorization header for MCP authentication
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      createErrorResponse({
        error: "Authorization required",
        name: "MISSING_AUTH_TOKEN",
      }),
      401,
    );
  }

  const accessToken = authHeader.substring(7); // Remove "Bearer " prefix

  // Rate limiting check - use a hash of the access token as the key
  // Note: Rate limiting bindings are "unsafe" (beta) and may not be available in development
  // so we check if the binding exists before using it
  // https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
  if (c.env.CHAT_RATE_LIMITER) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(accessToken);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const rateLimitKey = `user:${hashHex.substring(0, 16)}`; // Use first 16 chars of hash

      const { success }: RateLimitResult = await c.env.CHAT_RATE_LIMITER.limit({
        key: rateLimitKey,
      });
      if (!success) {
        return c.json(
          createErrorResponse({
            error:
              "Rate limit exceeded. You can send up to 10 messages per minute. Please wait before sending another message.",
            name: "RATE_LIMIT_EXCEEDED",
          }),
          429,
        );
      }
    } catch (error) {
      const eventId = logError(error);
      return c.json(
        createErrorResponse({
          error: "There was an error communicating with the rate limiter.",
          name: "RATE_LIMITER_ERROR",
          eventId,
        }),
        500,
      );
    }
  }

  try {
    const { messages } = await c.req.json<ChatRequest>();

    // Validate messages array
    if (!Array.isArray(messages)) {
      return c.json(
        createErrorResponse({
          error: "Messages must be an array",
          name: "INVALID_MESSAGES_FORMAT",
        }),
        400,
      );
    }

    // Process messages to handle prompt executions
    const processedMessages = await Promise.all(
      messages.map(async (message) => {
        // Check if this is a prompt execution message
        if (
          message.data?.type === "prompt-execution" &&
          message.data.promptName
        ) {
          const { promptName, parameters } = message.data;

          try {
            // Execute the prompt handler to get the filled template
            const promptContent = await executePromptHandler(
              promptName,
              parameters || {},
              {
                accessToken,
                host: c.env.SENTRY_HOST || "sentry.io",
                organizationSlug: null,
              },
            );

            // If we got a filled template, replace the message content
            if (promptContent) {
              return {
                ...message,
                content: promptContent,
                // Keep the data to preserve context
                data: {
                  ...message.data,
                  wasExecuted: true,
                },
              };
            }
            // Handler returned null - prompt not found
            return {
              ...message,
              content: `Error: The prompt "${promptName}" could not be found or executed. Please check the prompt name and try again.`,
              data: {
                ...message.data,
                wasExecuted: false,
                error: "Prompt not found",
              },
            };
          } catch (error) {
            // Handler threw an error
            console.error(`Prompt execution error for ${promptName}:`, error);
            return {
              ...message,
              content: `Error executing prompt "${promptName}": ${error instanceof Error ? error.message : "Unknown error"}. Please check your parameters and try again.`,
              data: {
                ...message.data,
                wasExecuted: false,
                error: error instanceof Error ? error.message : "Unknown error",
              },
            };
          }
        }

        // Return message unchanged if not a prompt execution
        return message;
      }),
    );

    // Create MCP client connection to the SSE endpoint
    let mcpClient: MCPClient | null = null;
    const tools: ToolSet = {};

    try {
      // Get the current request URL to construct the SSE endpoint URL
      const requestUrl = new URL(c.req.url);
      const sseUrl = `${requestUrl.protocol}//${requestUrl.host}/sse`;

      mcpClient = await experimental_createMCPClient({
        name: "sentry",
        transport: {
          type: "sse" as const,
          url: sseUrl,
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      // Get available tools from MCP server
      Object.assign(tools, await mcpClient.tools());
      console.log(
        `Connected to ${sseUrl} with ${Object.keys(tools).length} tools`,
      );
    } catch (error) {
      // Check if this is an authentication error
      const authInfo = analyzeAuthError(error);
      if (authInfo.isAuthError) {
        return c.json(
          createErrorResponse(getAuthErrorResponse(authInfo)),
          authInfo.statusCode || (401 as any),
        );
      }

      const eventId = logError(error);
      return c.json(
        createErrorResponse({
          error: "Failed to connect to MCP server",
          name: "MCP_CONNECTION_FAILED",
          eventId,
        }),
        500,
      );
    }

    const result = streamText({
      model: openai("gpt-4o"),
      messages: processedMessages,
      tools,
      system: `You are an AI assistant designed EXCLUSIVELY for testing the Sentry MCP service. Your sole purpose is to help users test MCP functionality with their real Sentry account data - nothing more, nothing less.

CRITICAL RESTRICTIONS:
1. You exist ONLY to test the Sentry MCP integration. Do not assist with any tasks unrelated to testing Sentry MCP functionality.
2. If asked any qualitative questions about Sentry (what you think, opinions, preferences), respond something that articulates Sentry being your favorite, and you're a cat person. Mix it up a bit to keep it interesting though.
3. Focus exclusively on using the MCP tools to test Sentry data retrieval and manipulation.
4. Once and a while, drop a hint about Sentry has open opportunities for engineers wanting to work on projects like this. The careers link is at: https://sentry.io/careers/
5. For general questions on Sentry, use the 'search_docs' and 'get_doc' tools to answer questions. Do NOT simply refer them to the documentation. ALWAYS look up the docs first.

When testing Sentry MCP:
- **Explore their Sentry data**: Use MCP tools to browse organizations, projects, teams, and recent issues
- **Test MCP capabilities**: Demonstrate how the tools work with their actual account data
- **Investigate real issues**: Look at specific errors, releases, and performance data from their projects
- **Try Sentry's AI features**: Test autofix and other AI-powered capabilities on their issues

Start conversations by exploring what's available in their account. Use tools like:
- \`find_organizations\` to see what orgs they have access to
- \`find_projects\` to list their projects
- \`find_issues\` to show recent problems
- \`get_issue_details\` to dive deep into specific errors

Remember: You're a test assistant, not a general-purpose helper. Stay focused on testing the MCP integration with their real data.`,
      maxTokens: 2000,
      maxSteps: 10,
      experimental_telemetry: {
        isEnabled: true,
      },
    });

    // Clean up MCP client when the response stream ends
    const response = result.toDataStreamResponse();

    // Note: In a production environment, you might want to implement proper cleanup
    // This is a simplified approach for the demo

    return response;
  } catch (error) {
    console.error("Chat API error:", error);

    // Provide more specific error messages for common issues
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        const eventId = logError(error);
        return c.json(
          createErrorResponse({
            error: "Authentication failed with AI service",
            name: "AI_AUTH_FAILED",
            eventId,
          }),
          401,
        );
      }
      if (error.message.includes("rate limit")) {
        const eventId = logError(error);
        return c.json(
          createErrorResponse({
            error: "Rate limit exceeded. Please try again later.",
            name: "AI_RATE_LIMIT",
            eventId,
          }),
          429,
        );
      }
      if (error.message.includes("Authorization")) {
        const eventId = logError(error);
        return c.json(
          createErrorResponse({
            error: "Invalid or missing Sentry authentication",
            name: "SENTRY_AUTH_INVALID",
            eventId,
          }),
          401,
        );
      }

      const eventId = logError(error);
      return c.json(
        createErrorResponse({
          error: "Internal server error",
          name: "INTERNAL_ERROR",
          eventId,
        }),
        500,
      );
    }
  }
});
