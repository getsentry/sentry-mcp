# AI Conversations MCP Specification

## Overview

AI Conversations should be a first-class MCP concept with conversation-shaped
search and detail retrieval. Users should not need to know that conversations
are implemented on top of spans or the `gen_ai.conversation.id` span attribute.

The MCP interface should expose:

- `search_ai_conversations` for finding and listing matching conversations
- `get_ai_conversation_details` for fetching one conversation transcript by ID
- `get_sentry_resource` for fetching one conversation from a Sentry URL

Raw span search remains available for lower-level telemetry investigation, but
it is not the primary interface for conversation discovery.

## Motivation

AI Conversations string together related GenAI spans into an agent session or
thread. The user intent is conversation-level:

- "show recent AI conversations"
- "find failed conversations"
- "search conversations where the user asked about checkout"
- "show conversations that used this tool"
- "find expensive conversations"

Using `search_events` with `dataset="spans"` returns span rows. That leaks the
implementation detail and can produce many rows per conversation. Conversation
search should instead return one row per conversation, with conversation-level
summary fields and clear follow-up paths to inspect the transcript or related
traces.

## User Model

An AI Conversation is a logical agent session or thread made from related GenAI
telemetry. In MCP, users interact with three shapes:

1. **Conversation summary**: a row in search/list results.
2. **Conversation detail**: a transcript and structured artifact for one
   conversation.
3. **Conversation URL**: a stable Sentry Explore URL that can be passed to
   `get_sentry_resource`.

Spans are an implementation detail for this feature. Use span search only when
the user explicitly wants raw span-level analysis or needs to debug underlying
telemetry.

## Tool Surface

Add one catalog-only tool:

```text
search_ai_conversations
```

Keep existing tools:

- `get_ai_conversation_details`: fetches one conversation by
  `gen_ai.conversation.id`
- `get_sentry_resource`: detects conversation URLs and routes to conversation
  details
- `search_events`: searches raw events, logs, spans, metrics, profiles, and
  replays

Do not add AI conversation tools to the top-level direct MCP surface for now.
Catalog-only is sufficient because:

- `get_sentry_resource` handles pasted Sentry conversation URLs directly.
- `search_sentry_tools` and `execute_sentry_tool` can discover and invoke
  catalog tools.
- The default direct surface remains small.

## Search Interface

`search_ai_conversations` answers conversation-level discovery questions. It
returns one item per conversation, never one item per span.

```typescript
interface SearchAIConversationsParams {
  organizationSlug: string;
  query?: string;
  samplingMode?:
    | "NORMAL"
    | "HIGHEST_ACCURACY"
    | "HIGHEST_ACCURACY_FLEX_TIME";
  project?: string | string[];
  environment?: string | string[];
  statsPeriod?: string;
  start?: string;
  end?: string;
  limit?: number;
  cursor?: string;
  regionUrl?: string;
}
```

Parameter behavior:

- `organizationSlug` is required.
- `query` is a user-facing conversation query/filter string passed to the
  Sentry AI Conversations list endpoint.
- Results use the Sentry endpoint's default ordering: most recent conversation
  activity first. Do not expose alternate sort options until the backend applies
  them.
- `samplingMode` uses the Sentry endpoint's supported sampling modes. If
  omitted, the backend defaults to `HIGHEST_ACCURACY`.
- `project` scopes results to one or more projects. The backend accepts numeric
  project IDs; MCP may resolve project slugs to IDs for ergonomics.
- `environment` scopes results to one or more environments.
- `statsPeriod` or `start`/`end` controls the time range.
- `limit` controls page size and must respect the backend maximum.
- `cursor` requests the next page when Sentry pagination provides one.
- `regionUrl` selects the Sentry region endpoint.

## Backend API

Use the Sentry AI Conversations list endpoint:

```text
GET /api/0/organizations/{organizationSlug}/ai-conversations/
```

Do not implement conversation search through
`search_events(dataset="spans")`.

Expected query parameters:

- `query`
- `samplingMode`
- `project`
- `environment`
- `statsPeriod` or `start`/`end`
- `cursor`
- `per_page`

Expected response item shape:

```typescript
interface AIConversationSummary {
  conversationId: string;
  flow: string[];
  startTimestamp: number;
  endTimestamp: number;
  errors: number;
  firstInput: string | null;
  lastOutput: string | null;
  llmCalls: number;
  toolCalls: number;
  toolErrors: number;
  toolNames: string[];
  totalTokens: number;
  totalCost: number;
  traceCount: number;
  traceIds: string[];
  user: {
    id: string | null;
    email: string | null;
    username: string | null;
    ip_address: string | null;
  } | null;
}
```

This shape is based on the Sentry backend source, specifically
`src/sentry/api/endpoints/organization_ai_conversations.py` and
`src/sentry/api/serializers/rest_framework/ai_conversations.py` in the Sentry
repository.

## Search Output

The formatted `search_ai_conversations` response should be optimized for agent
use and should include:

- A title with the organization, query, and time range.
- An executed search block showing the query, filters, and page size.
- A Sentry Explore conversations URL when constructible.
- Conversation summaries.
- A structured JSON artifact.
- Next-step instructions.

Each result should include:

- Conversation ID.
- Sentry URL: `/explore/conversations/{conversationId}/`.
- Start, end, and derived duration.
- Flow, when available.
- First input preview.
- Last output preview.
- User summary.
- Error count.
- LLM call count.
- Tool call count and tool error count.
- Tool names.
- Total tokens and total cost.
- Trace count and trace IDs.

Next-step instructions should direct agents to:

- Use `get_ai_conversation_details` with `conversationId` for the transcript and
  full structured detail.
- Use `get_sentry_resource` with the conversation URL when the user provides or
  wants to reuse a Sentry URL.
- Query spans with `search_events` using dataset `spans` and query
  `gen_ai.conversation.id:<conversationId>` when inspecting telemetry for the
  full conversation across traces.
- Treat listed trace IDs as per-trace follow-up targets only; a conversation can
  span multiple traces.

## Detail Interface

`get_ai_conversation_details` remains the transcript/detail tool.

Current expected behavior:

- Input is organization slug plus conversation ID.
- Output includes a transcript grouped into turns.
- User and assistant messages are extracted from GenAI input/output fields.
- Tool calls are attached to the nearest turn.
- Trace IDs, projects, span IDs, token totals, and summary counts are included.
- A structured JSON artifact is included.

Required refinements:

- Update the description to recommend `search_ai_conversations` for discovering
  or listing conversations.
- Keep raw span search documented only as a fallback for low-level telemetry
  analysis.
- Accept `start` and `end` when details are fetched from a URL with explicit
  time bounds.
- Continue accepting `project` from URL query parameters.
- If `spanId` is supplied from a URL, include focus metadata or highlight
  whether the focused span is present in the conversation.

## URL Handling

`get_sentry_resource` is the primary URL entrypoint for conversations.

Supported URL pattern:

```text
/explore/conversations/{conversationId}/
```

The URL parser should extract:

- `conversationId`
- `project`
- `start`
- `end`
- `spanId`

Fetch by URL must not require `search_ai_conversations`. If a user pastes a
conversation URL, `get_sentry_resource` should route directly to
`get_ai_conversation_details`.

## Relationship To Traces

Traces and conversations should have parallel concepts:

Conversation:

- `search_ai_conversations`: returns matching conversations.
- `get_ai_conversation_details`: returns one full conversation.

Trace:

- `get_trace_details`: returns one full trace by trace ID.
- A true trace-level search tool does not currently exist.
- `search_events(dataset="spans")` returns span rows, not trace rows.

A conversation can include spans from multiple traces. `get_trace_details`
should not be the primary conversation follow-up because it only inspects one
trace. Agents should query spans by `gen_ai.conversation.id` when they need
conversation-related telemetry across trace boundaries.

AI Conversations should not copy the current trace-search limitation.
Conversation search should be conversation-native from the start.

## Relationship To Spans

Use `search_events(dataset="spans")` only for:

- Debugging raw GenAI spans.
- Finding available attributes.
- Investigating a specific trace or conversation at the span level.
- Running aggregate telemetry analysis.

Do not route ordinary conversation discovery through spans once
`search_ai_conversations` exists.

## API Client Requirements

Add parsed schemas for:

- `AIConversationUserSchema`
- `AIConversationSummarySchema`
- `AIConversationSummaryListSchema`

Add an API client method:

```typescript
searchAIConversations(params, opts?)
```

The method should:

- Build query parameters safely.
- Support repeated `project` and `environment` parameters.
- Support `statsPeriod` or `start`/`end`.
- Support `cursor` and `per_page`.
- Avoid sending `sort` until the Sentry endpoint applies alternate ordering.
- Parse the list response.
- Preserve pagination metadata if existing client patterns support it.

If pagination metadata is not modeled elsewhere, the first implementation may
return the current page and expose a clear follow-up path for adding cursor
metadata.

## Source Verification Requirements

Before implementing or changing any AI Conversations endpoint usage, verify the
current request and response contract against the Sentry source tree in
`~/src/sentry`. Do not rely only on UI assumptions, API docs, or existing MCP
schemas.

For this spec, the relevant source files are:

- `src/sentry/api/endpoints/organization_ai_conversations.py`
- `src/sentry/api/endpoints/organization_ai_conversation_details.py`
- `src/sentry/api/serializers/rest_framework/ai_conversations.py`
- `tests/sentry/api/endpoints/test_organization_ai_conversations.py`
- `tests/sentry/api/endpoints/test_organization_ai_conversation_details.py`

The implementation should be updated if those files show that accepted query
parameters, ordering behavior, sampling modes, response fields, pagination
behavior, feature gates, or retention behavior differ from this spec.

## Tool Registration

Register `search_ai_conversations` in the catalog.

Do not add it to:

- `TOP_LEVEL_TOOL_NAMES`
- wrapper tools
- direct surface lists

After tool changes, run:

```bash
pnpm run --filter @sentry/mcp-core generate-definitions
```

## Documentation Requirements

Update tool descriptions so agents follow this workflow:

1. Use `search_ai_conversations` to find or list AI Conversations.
2. Use `get_ai_conversation_details` to fetch a transcript by conversation ID.
3. Use `get_sentry_resource` for Sentry conversation URLs.
4. Use `search_events` with `dataset="spans"` only for raw span-level analysis.

At minimum, update:

- `get_ai_conversation_details` description.
- `get_sentry_resource` AI conversation guidance.
- Generated tool and skill definitions.

## Examples

Search recent conversations:

```typescript
search_ai_conversations({
  organizationSlug: "my-org",
  query: "recent conversations",
  statsPeriod: "24h",
})
```

Find failed conversations:

```typescript
search_ai_conversations({
  organizationSlug: "my-org",
  query: "failed conversations",
  statsPeriod: "7d",
})
```

Fetch a transcript from a result:

```typescript
get_ai_conversation_details({
  organizationSlug: "my-org",
  conversationId: "conversation-123",
})
```

Fetch from a Sentry URL:

```typescript
get_sentry_resource({
  url: "https://my-org.sentry.io/explore/conversations/conversation-123/",
})
```

## Testing

Add focused tests for:

1. Basic search:
   - Calls `/organizations/{org}/ai-conversations/`.
   - Passes `query`, `per_page`, and time parameters.
   - Renders one row per conversation.
2. Empty results:
   - Returns a clear "No AI conversations found" message.
   - Includes the executed search.
3. Filters:
   - `project`
   - `environment`
   - `statsPeriod`
   - explicit `start` and `end`
   - `cursor`
4. Formatting:
   - Includes conversation URLs.
   - Includes first input and last output previews.
   - Includes tool names and tool errors.
   - Includes trace IDs.
   - Includes next-step instructions.
5. Content block normalization:
   - `firstInput` arrays become readable text.
6. Catalog registration:
   - Tool is in the catalog.
   - Tool is not in the top-level direct surface.
7. Existing URL behavior:
   - `get_sentry_resource(url=conversationUrl)` still routes to details.

## Acceptance Criteria

This feature is complete when:

- Users can search and list AI Conversations without knowing about spans.
- Search results are conversation summaries, not span rows.
- Users can fetch details by conversation ID.
- Users can fetch details by Sentry conversation URL.
- Tool descriptions route agents toward the conversation-native workflow.
- `search_events(dataset="spans")` remains available but is no longer the
  recommended conversation discovery path.
- Generated definitions are updated.
- Focused tests pass.

## Future Work

- Add a trace-level search tool that returns one row per trace, parallel to
  `search_ai_conversations`.
- Add richer focused-span behavior for conversation URLs with `spanId`.
- Add pagination metadata to formatted output if the API client standardizes
  cursor handling.
