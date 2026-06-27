import { searchIssueEventsAgent } from "@sentry/mcp-core/tools/search-issue-events/agent";
import { SentryApiService } from "@sentry/mcp-core/api-client";
import { defineAgentEval } from "./utils";

defineAgentEval(
  "search-issue-events-agent",
  [
    {
      // Simple time-based query - should NOT require tool calls
      input: "Show me events from the last hour",
      expectedTools: [],
      expected: {
        query: "", // No additional filters beyond issue constraint
        sort: "-timestamp",
        timeRange: { statsPeriod: "1h" },
      },
    },
    {
      // Environment and release filtering - should NOT require tool calls
      input: "Find production events with release v1.0.5",
      expectedTools: [],
      expected: {
        query:
          /environment:production.*release:v1\.0\.5|release:v1\.0\.5.*environment:production/,
        sort: "-timestamp",
      },
    },
    {
      // User-specific filtering - may require whoami if query uses "me"
      input: "Show me events affecting user alice@example.com",
      expectedTools: [],
      expected: {
        query: "user.email:alice@example.com",
        sort: "-timestamp",
      },
    },
    {
      // Query with "me" reference - should require whoami
      input: "Show me events from my user",
      expectedTools: [
        {
          name: "whoami",
          arguments: {},
        },
      ],
      expected: {
        query: /user\.email:test@example\.com|user:test@example\.com/, // Various valid forms
        sort: "-timestamp",
      },
    },
    {
      // Trace ID filtering - should NOT require tool calls
      input: "Find events with trace ID abc123def456",
      expectedTools: [],
      expected: {
        query: "trace:abc123def456",
        sort: "-timestamp",
      },
    },
    {
      // URL pattern filtering - should NOT require tool calls
      input: "Show me events from the /checkout/ page",
      expectedTools: [],
      expected: {
        query: /"url:.*\/checkout\/.*"|url:".*checkout.*"/, // URL pattern with wildcard
        sort: "-timestamp",
      },
    },
    {
      // Combined filters with time range
      input: "Production events from yesterday with specific release",
      expectedTools: [],
      expected: {
        query:
          /environment:production.*release:|release:.*environment:production/,
        sort: "-timestamp",
        timeRange: { statsPeriod: "24h" },
      },
    },
    {
      // Query that might need field discovery for uncommon tags
      input: "Events where device family is mobile",
      expectedTools: [
        {
          name: "issueEventFields",
          arguments: {},
        },
      ],
      expected: {
        query: /device\.family:mobile|device:mobile/,
        sort: "-timestamp",
      },
    },
  ],
  async (input) => {
    // Create a real API service that will use MSW mocks
    const apiService = new SentryApiService({
      accessToken: "test-token",
    });

    const agentResult = await searchIssueEventsAgent({
      query: input,
      organizationSlug: "sentry-mcp-evals",
      apiService,
    });

    return {
      result: JSON.stringify(agentResult.result),
      toolCalls: agentResult.toolCalls.map((call) => ({
        name: call.toolName,
        arguments: call.args,
      })),
    };
  },
  {
    threshold: 0.6,
  },
);
