import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * A task runner that executes requests through the use_sentry agent tool via MCP protocol.
 * This tests agent mode output quality using LLM-as-a-judge scorers.
 *
 * The runner connects to the MCP server via stdio and calls use_sentry,
 * then returns the output for quality scoring (not tool call validation).
 *
 * @example
 * ```typescript
 * import { AgentModeTaskRunner } from './utils/agentModeRunner';
 * import { describeEval } from 'vitest-evals';
 *
 * describeEval("list-issues (agent)", {
 *   data: async () => [
 *     {
 *       input: "Show me the most common errors in my-org",
 *     }
 *   ],
 *   task: AgentModeTaskRunner(),
 *   scorers: [SemanticSimilarityScorer(), ErrorHandlingScorer()],
 *   threshold: 0.7
 * });
 * ```
 */
export function AgentModeTaskRunner() {
  return async function AgentModeTaskRunner(input: string) {
    // Connect to MCP server via stdio (same pattern as ToolPredictionScorer)
    const transport = new StdioClientTransport({
      command: "pnpm",
      args: [
        "exec",
        "sentry-mcp",
        "--access-token=mocked-access-token",
        "--all-scopes", // Grant all scopes for testing
      ],
      env: {
        ...process.env,
        SENTRY_ACCESS_TOKEN: process.env.SENTRY_ACCESS_TOKEN || "test-token",
        SENTRY_HOST: "sentry.io",
      },
    });

    const client = new Client(
      {
        name: "eval-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    try {
      await client.connect(transport);

      // Call use_sentry tool
      const result = await client.callTool({
        name: "use_sentry",
        arguments: {
          request: input,
        },
      });

      // Extract text from tool result
      const resultText = (
        result.content as Array<{ type: string; text?: string }>
      )
        .map((c: { type: string; text?: string }) =>
          c.type === "text" ? c.text : "",
        )
        .join("\n");

      return {
        result: resultText,
        toolCalls: [], // Agent mode doesn't track tool calls, just validates output quality
      };
    } catch (error) {
      // If the agent encounters an error, return it as the result
      // This allows scorers to evaluate error handling
      return {
        result: error instanceof Error ? error.message : String(error),
        toolCalls: [],
      };
    } finally {
      // Clean up connection
      await client.close();
    }
  };
}
