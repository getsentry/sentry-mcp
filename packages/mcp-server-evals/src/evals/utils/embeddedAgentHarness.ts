import { SentryApiService } from "@sentry/mcp-core/api-client";
import { searchEventsAgent } from "@sentry/mcp-core/tools/search-events/agent";
import { searchIssueEventsAgent } from "@sentry/mcp-core/tools/search-issue-events/agent";
import { searchIssuesAgent } from "@sentry/mcp-core/tools/search-issues/agent";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import type { JsonValue, ToolCallRecord } from "vitest-evals";
import { withFallbackSession } from "./fallbackSession";
import { FIXTURES } from "./fixtures";
import { requireJsonValue, toJsonRecord } from "./json";
import type { StructuredEvalMetadata } from "./types";

type CapturedToolCall = {
  toolName: string;
  args: unknown;
};

type EmbeddedSearchAgentOptions = {
  query: string;
  organizationSlug: string;
  apiService: SentryApiService;
  projectId?: string;
};

type EmbeddedSearchAgentResult = {
  result: unknown;
  toolCalls: CapturedToolCall[];
  steps?: unknown[];
  usage?: unknown;
  totalUsage?: unknown;
};

type EmbeddedSearchAgent = (
  options: EmbeddedSearchAgentOptions,
) => Promise<EmbeddedSearchAgentResult>;

function toToolCallRecord(call: CapturedToolCall): ToolCallRecord {
  return {
    name: call.toolName,
    arguments: toJsonRecord(call.args),
  };
}

export function createEmbeddedSearchAgentHarness(
  name: string,
  agent: EmbeddedSearchAgent,
) {
  return aiSdkHarness<
    undefined,
    string,
    StructuredEvalMetadata,
    EmbeddedSearchAgentResult,
    Record<string, never>,
    JsonValue
  >({
    name,
    run: async ({ input }) => {
      const apiService = new SentryApiService({
        accessToken: "test-token",
      });

      const result = await agent({
        query: input,
        organizationSlug: FIXTURES.organizationSlug,
        apiService,
      });

      return withFallbackSession(
        input,
        result,
        requireJsonValue(result.result, "agent output"),
        result.toolCalls.map(toToolCallRecord),
      );
    },
    output: ({ result }) => requireJsonValue(result.result, "agent output"),
  });
}

export const searchEventsAgentHarness = createEmbeddedSearchAgentHarness(
  "search-events-agent",
  searchEventsAgent,
);

export const searchIssueEventsAgentHarness = createEmbeddedSearchAgentHarness(
  "search-issue-events-agent",
  searchIssueEventsAgent,
);

export const searchIssuesAgentHarness = createEmbeddedSearchAgentHarness(
  "search-issues-agent",
  searchIssuesAgent,
);
