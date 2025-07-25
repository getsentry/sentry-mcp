import { tool } from "ai";
import { z } from "zod";
import { callEmbeddedAgent } from "./callEmbeddedAgent";

// Output schemas from the actual agents
export const SearchEventsOutputSchema = z.object({
  dataset: z
    .enum(["spans", "errors", "logs"])
    .optional()
    .describe("Which dataset to use for the query"),
  query: z
    .string()
    .optional()
    .describe("The Sentry query string for filtering results"),
  fields: z
    .array(z.string())
    .optional()
    .describe("Fields to return in the results"),
  sort: z.string().optional().describe("Sort parameter (e.g., '-timestamp')"),
  timeRange: z
    .union([
      z.object({ statsPeriod: z.string() }),
      z.object({ start: z.string(), end: z.string() }),
    ])
    .optional()
    .describe("Time range for the query"),
  error: z
    .string()
    .optional()
    .describe("Error message if query cannot be translated"),
});

export const SearchIssuesOutputSchema = z.object({
  query: z.string().describe("The Sentry issue search query"),
  sort: z
    .enum(["date", "freq", "new", "user"])
    .nullable()
    .describe("How to sort the results (null if no specific sort is needed)"),
  explanation: z
    .string()
    .nullable()
    .describe("Brief explanation of the translation (null if not needed)"),
});

/**
 * Test version of the search events agent
 */
export async function testSearchEventsAgent(
  query: string,
  organizationSlug = "sentry-mcp-evals",
) {
  // System prompt from the actual agent (simplified)
  const systemPrompt = `You are a Sentry query translator. You need to:
1. FIRST determine which dataset (spans, errors, or logs) is most appropriate for the query
2. Query the available attributes for that dataset using the datasetAttributes tool
3. Use the otelSemantics tool if you need OpenTelemetry semantic conventions
4. Use the whoami tool when queries contain "me" or "my" references
5. Convert the natural language query to Sentry's search syntax

DATASET SELECTION:
- errors: Exceptions, crashes, error messages, stack traces
- spans: Performance data, API calls, slow operations, duration metrics
- logs: Log entries, log messages

Always include a sort parameter (e.g., "-timestamp" for errors/logs, "-span.duration" for spans).`;

  const tools = {
    datasetAttributes: tool({
      description: "Get available dataset attributes for the organization",
      parameters: z.object({
        organizationSlug: z.string(),
        dataset: z.enum(["errors", "logs", "spans"]),
      }),
      execute: async (args) => {
        // Mock response
        const fields: Record<string, any> = {};
        if (args.dataset === "errors") {
          fields.title = { type: "string" };
          fields["user.email"] = { type: "string" };
          fields.timestamp = { type: "date" };
        } else if (args.dataset === "spans") {
          fields["span.duration"] = { type: "duration" };
          fields["span.op"] = { type: "string" };
        }
        return { fields };
      },
    }),
    otelSemantics: tool({
      description: "Look up OpenTelemetry semantic conventions",
      parameters: z.object({
        category: z.string().optional(),
        search: z.string().optional(),
      }),
      execute: async () => {
        return { attributes: [] };
      },
    }),
    whoami: tool({
      description: "Get information about the current user",
      parameters: z.object({}),
      execute: async () => {
        return { id: "123456", email: "test@example.com" };
      },
    }),
  };

  return callEmbeddedAgent({
    system: systemPrompt,
    prompt: query,
    tools,
    schema: SearchEventsOutputSchema,
  });
}

/**
 * Test version of the search issues agent
 */
export async function testSearchIssuesAgent(
  query: string,
  organizationSlug = "sentry-mcp-evals",
) {
  // System prompt from the actual agent (simplified)
  const systemPrompt = `You are an agent that translates natural language queries into Sentry issue search syntax.

Use the available tools to:
1. Get available issue fields for the organization
2. Get user information if the query references "me" or "my"

Then generate the appropriate search query.`;

  const tools = {
    issueFields: tool({
      description: "Get available issue fields for the organization",
      parameters: z.object({
        organizationSlug: z.string(),
      }),
      execute: async () => {
        // Mock response
        return {
          fields: [
            { key: "is", name: "Status", type: "status" },
            { key: "assigned", name: "Assigned To", type: "user" },
            { key: "level", name: "Level", type: "choice" },
          ],
        };
      },
    }),
    whoami: tool({
      description: "Get information about the current user",
      parameters: z.object({}),
      execute: async () => {
        return { id: "123456", email: "test@example.com" };
      },
    }),
  };

  return callEmbeddedAgent({
    system: systemPrompt,
    prompt: query,
    tools,
    schema: SearchIssuesOutputSchema,
  });
}
