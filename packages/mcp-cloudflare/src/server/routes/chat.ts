import { Hono } from "hono";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { experimental_createMCPClient } from "ai";
import type { Env } from "../types";
import { logError } from "@sentry/mcp-server/logging";

export default new Hono<{ Bindings: Env }>().post("/", async (c) => {
  // Validate that we have an OpenAI API key
  if (!c.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not configured");
    return c.json({ error: "AI service not configured" }, 500);
  }

  // Get the authorization header for MCP authentication
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Authorization required" }, 401);
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

      const { success } = await c.env.CHAT_RATE_LIMITER.limit({
        key: rateLimitKey,
      });
      if (!success) {
        return c.json(
          {
            error:
              "Rate limit exceeded. You can send up to 10 messages per minute. Please wait before sending another message.",
          },
          429,
        );
      }
    } catch (error) {
      logError(error);
      return c.json(
        { error: "There was an error communicating with the rate limiter." },
        500,
      );
    }
  }

  try {
    const { messages } = await c.req.json();

    // Validate messages array
    if (!Array.isArray(messages)) {
      return c.json({ error: "Messages must be an array" }, 400);
    }

    // Create MCP client connection to the SSE endpoint
    let mcpClient: any = null;
    let tools = {};

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
      tools = await mcpClient.tools();
      console.log(
        `Connected to ${sseUrl} with ${Object.keys(tools).length} tools`,
      );
    } catch (error) {
      logError(error);
      return c.json({ error: "Failed to connect to MCP server" }, 500);
    }

    const result = streamText({
      model: openai("gpt-4o"),
      messages,
      tools,
      system: `You are an AI assistant helping users test and explore the Sentry MCP (Model Context Protocol) integration using their real Sentry account data.

Your primary goal is to help users:
- **Explore their Sentry data**: Use MCP tools to browse organizations, projects, teams, and recent issues
- **Test MCP capabilities**: Demonstrate how the tools work with their actual account data
- **Investigate real issues**: Look at specific errors, releases, and performance data from their projects
- **Try Sentry's AI features**: Test autofix and other AI-powered capabilities on their issues

Start conversations by exploring what's available in their account. Use tools like:
- \`find_organizations\` to see what orgs they have access to
- \`find_projects\` to list their projects
- \`find_issues\` to show recent problems
- \`get_issue_details\` to dive deep into specific errors

Keep responses focused on demonstrating the MCP integration and working with their real data. This is a testing/demo environment, so encourage exploration and experimentation with the available tools.`,
      maxTokens: 2000,
      maxSteps: 10,
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
        return c.json({ error: "Authentication failed with AI service" }, 401);
      }
      if (error.message.includes("rate limit")) {
        return c.json(
          { error: "Rate limit exceeded. Please try again later." },
          429,
        );
      }
      if (error.message.includes("Authorization")) {
        return c.json(
          { error: "Invalid or missing Sentry authentication" },
          401,
        );
      }
    }

    return c.json(
      {
        error: "Internal server error",
      },
      500,
    );
  }
});
