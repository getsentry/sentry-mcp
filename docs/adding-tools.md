# Adding New Tools

Step-by-step guide for adding new tools to the Sentry MCP server.

## Tool Visibility & Selection

Not every tool is exposed to every consumer. We rely on several mechanisms to keep the active tool set manageable:

- **`requiredCapabilities`** — Tools declare which project capabilities they need (e.g. `profiles`, `replays`, `traces`). If the upstream project doesn't have a capability enabled, the tool is automatically hidden.
- **`internalOnly`** — Composition primitives (e.g. `get_issue_details`, `get_trace_details`) that are only called by other tools like `get_sentry_resource`, never exposed directly via MCP.
- **`experimental` / `hideInExperimentalMode`** — Feature flags for tools that are being tested or replaced.
- **Skills & constraints** — The server filters tools based on granted skills and org/project constraints.

We also expect upstream consumers (Claude Code plugins, Cursor, etc.) to use **tool selection** or **progressive disclosure** on their end. The total registered tool count can exceed what any single session needs because consumers pick a relevant subset.

## Tool Count Limits

Target ~20 publicly visible tools. Never exceed 25. AI agents have limited tool slots (Cursor caps at 45 total across all providers), so Sentry MCP cannot consume all available slots.

Before adding a new tool, consider if it could be:
1. Combined with an existing tool
2. Implemented as a parameter variant
3. Gated behind `requiredCapabilities` if only relevant to some projects

## Tool Structure

Each tool consists of:
1. **Tool Module** - Single file in `src/tools/your-tool-name.ts` with definition and handler
2. **Tests** - Unit tests in `src/tools/your-tool-name.test.ts`
3. **Mocks** - API responses in `mcp-server-mocks`
4. **Evals** - Integration tests (use sparingly)

## Step 1: Create the Tool Module

Create `packages/mcp-server/src/tools/your-tool-name.ts`:

```typescript
import { z } from "zod";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import type { ServerContext } from "../types";

export default defineTool({
  name: "your_tool_name",
  description: [
    "One-line summary.",
    "",
    "Use this tool when you need to:",
    "- Specific use case 1",
    "- Specific use case 2",
    "",
    "<examples>",
    "your_tool_name(organizationSlug='my-org', param='value')",
    "</examples>",
    "",
    "<hints>",
    "- Parameter interpretation hints",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: z.string().describe("The organization's slug"),
    regionUrl: z.string().optional().describe("Optional region URL"),
    yourParam: z.string().describe("What values are expected"),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // Implementation here
  },
});
```

### Safety Annotations

**REQUIRED**: All tools must include safety annotations for MCP directory compliance.

**Available annotations:**
- `readOnlyHint` (boolean): Tool doesn't modify data
- `destructiveHint` (boolean): Tool may modify/delete existing data
- `idempotentHint` (boolean): Repeated calls with same arguments have no additional effect
- `openWorldHint` (boolean): Tool interacts with external services (default: true for API calls)

**Annotation patterns:**

```typescript
// Read-only tools (queries, lists, searches)
annotations: {
  readOnlyHint: true,
  openWorldHint: true,
}

// Create tools (additive, non-destructive)
annotations: {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
}

// Update tools (modify existing data)
annotations: {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,  // Same update twice = same result
  openWorldHint: true,
}
```

### Writing LLM-Friendly Descriptions

Critical for LLM success:
- Start with "Use this tool when you need to:"
- Include concrete examples
- Reference related tools
- Explain parameter formats in `.describe()`

## Step 2: Implement the Handler

Add the handler implementation to your tool module:

```typescript
async handler(params, context: ServerContext) {
  // 1. Get API service
  const api = apiServiceFromContext(context, {
    regionUrl: params.regionUrl,
  });

  // 2. Validate inputs (see common-patterns.md#error-handling)
  if (!params.organizationSlug) {
    throw new UserInputError(
      "Organization slug is required. Use find_organizations() to list."
    );
  }

  // 3. Set monitoring tags
  setTag("organization.slug", params.organizationSlug);

  // 4. Call API
  const data = await api.yourMethod(params);

  // 5. Format response
  let output = `# Results in **${params.organizationSlug}**\n\n`;
  
  if (data.length === 0) {
    return output + "No results found.\n";
  }

  // 6. Format data
  output += formatYourData(data);

  // 7. Add next steps
  output += "\n\n# Using this information\n\n";
  output += "- Next tool to use: `related_tool(param='...')`\n";

  return output;
}
```

### Response Formatting

See [common-patterns.md](common-patterns.md#response-formatting) for:
- Markdown structure
- ID/URL formatting
- Next steps guidance

## Step 3: Add Tests

Follow comprehensive testing patterns from `testing.md` for unit, integration, and evaluation tests.

Create `packages/mcp-server/src/tools/your-tool-name.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import yourToolName from "./your-tool-name.js";

describe("your_tool_name", () => {
  it("returns formatted output", async () => {
    const result = await yourToolName.handler(
      { organizationSlug: "test-org", yourParam: "value" },
      {
        accessToken: "test-token",
        userId: "1",
        organizationSlug: null,
      }
    );
    
    expect(result).toMatchInlineSnapshot(`
      "# Results in **test-org**
      
      Expected output here"
    `);
  });
});
```

**Testing Requirements:**
- Input validation (see [testing.md](testing.md#testing-error-cases))
- Error handling (use patterns from [error-handling.md](error-handling.md))
- Output formatting with snapshots
- At least one happy-path test must snapshot the full formatted handler
  response with `toMatchInlineSnapshot()`; partial `toContain()` assertions are
  supplemental only
- API integration with MSW mocks

**After changing output, update snapshots:**
```bash
cd packages/mcp-server
pnpm vitest --run -u
```

## Step 4: Add Mocks

In `packages/mcp-server-mocks/src/handlers/`:

```typescript
{
  method: "get",
  path: "/api/0/organizations/:org/your-endpoint/",
  fetch: async ({ request, params }) => {
    // Validate parameters
    if (!params.org) {
      return HttpResponse.json("Invalid org", { status: 400 });
    }
    
    // Return fixture
    return HttpResponse.json(yourDataFixture);
  }
}
```

See [api-patterns.md](api-patterns.md#mock-patterns) for validation examples.

## Step 5: Add Evaluation Tests (Sparingly)

**⚠️ Each eval costs time and API credits. Only test core functionality!**

```typescript
describeEval("your-tool", {
  data: async () => [
    {
      input: `Primary use case in ${FIXTURES.organizationSlug}`,
      expected: "Expected response"
    },
    // Maximum 2-3 scenarios!
  ],
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
});
```

## Testing Workflow

```bash
# 1. Run unit tests
pnpm test tools.test

# 2. Test with inspector
pnpm inspector

# 3. Run minimal evals
pnpm eval your-tool
```

## Checklist

- [ ] Definition in `toolDefinitions.ts`
- [ ] Handler in `tools.ts`
- [ ] Unit tests with snapshots
- [ ] Mock responses
- [ ] 1-2 eval tests (if critical)
- [ ] Run quality checks

## Agent-in-Tool Pattern

Some tools (`search_events`, `search_issue_events`, and `search_issues`) embed
AI agents to normalize search parameters before the handler calls Sentry. Treat
the agent as a repair step for a structured request, not only as a natural
language query translator. The agent may rewrite the query string, but it may
also correct or fill related parameters such as dataset, fields, sort, and time
range when the provided combination would fail or produce the wrong result.

### When to Use This Pattern

1. **Parameter repair** - Fixing mismatched or incomplete search parameters
2. **Query normalization** - Converting natural language or loose syntax to
   valid Sentry search syntax
3. **Dynamic field discovery** - When available fields vary by project/context
4. **Semantic understanding** - When the tool needs to understand intent across multiple parameters

### When NOT to Use This Pattern

1. **Simple API calls** - Direct parameter mapping to API endpoints
2. **Deterministic operations** - Operations with clear, unambiguous inputs
3. **Performance-critical paths** - Embedded agents add latency and cost

### Architecture

```typescript
// Tool handler delegates to embedded agent
async handler(params, context) {
  const request = hasAgentProvider()
    ? await repairSearchParams({
        query: params.query,
        dataset: params.dataset,
        fields: params.fields,
        sort: params.sort,
        statsPeriod: params.statsPeriod,
      })
    : {
        query: params.query,
        dataset: params.dataset,
        fields: params.fields,
        sort: params.sort,
        statsPeriod: params.statsPeriod,
      };
  
  // Tool executes either the repaired request or the direct parameters.
  const results = await apiService.searchEvents({
    query: request.query,
    dataset: request.dataset,
    fields: request.fields,
    sort: request.sort,
    statsPeriod: request.statsPeriod,
  });
  
  return formatResults(results);
}
```

### Provider Availability

Direct-capable tools should still work when no embedded agent provider is
available. Use `hasAgentProvider()` to decide whether to run the repair step.
If it returns false because API keys are missing, both OpenAI and Anthropic keys
are set without an explicit provider, or Azure OpenAI is missing a supported
base URL, execute the direct parameters as provided.

Do not silently fall back after a provider has been selected and the provider API
call fails. Invalid keys, deactivated accounts, rate limits, and other provider
4xx responses should become user-facing `LLMProviderError`s from
`callEmbeddedAgent()`. That makes configuration/account problems visible instead
of hiding them behind an un-repaired direct search.

### Error Handling Philosophy

**DO NOT retry internally**. When the embedded agent fails:
1. Throw a clear `UserInputError` or `LLMProviderError` with specific guidance
2. Let the calling agent (Claude/Cursor) see the error
3. The calling agent can retry with corrections if needed

**IMPORTANT**: Keep system prompts static to enable LLM provider caching. Never modify prompts based on errors.

```typescript
// BAD: Dynamic prompt modification prevents caching
let systemPrompt = basePrompt;
if (previousError) {
  systemPrompt += `\nPrevious error: ${previousError}`;
}

// GOOD: Static prompt with clear error boundaries
const systemPrompt = STATIC_SYSTEM_PROMPT;
try {
  return await repairSearchParams(...);
} catch (error) {
  throw new UserInputError(
    `Could not repair search parameters: ${error.message}`,
  );
}
```

### Tool Boundaries

1. **Embedded Agent Responsibilities**:
   - Repair or normalize structured search parameters
   - Convert natural language to Sentry search syntax when needed
   - Discover available fields/attributes
   - Validate query syntax and parameter combinations

2. **Tool Handler Responsibilities**:
   - Execute the repaired request
   - Handle API errors
   - Format results for the calling agent

3. **Calling Agent Responsibilities**:
   - Decide when to use the tool
   - Handle errors and retry if needed
   - Interpret results

### Implementation Guidelines

1. **Create an AGENTS.md file** in the tool directory documenting:
   - The embedded agent's prompt and behavior
   - Common repair and normalization patterns
   - Known limitations

2. **Keep agent prompts focused** - Don't duplicate general MCP knowledge
3. **Use structured outputs** - Define clear schemas for agent responses
4. **Provide tool discovery** - Let agents explore available fields dynamically

See `packages/mcp-server/src/tools/search-events/` and `packages/mcp-server/src/tools/search-issues/` for examples.

## Worker-Specific Tools

Some tools may require access to Cloudflare Worker-specific bindings (like AutoRAG, D1, R2, etc.) that aren't available in the standard ServerContext. For these cases, create a separate endpoint in the Worker that the tool can call.

### Example: RAG Search Endpoint

The `search_docs` tool demonstrates this pattern:

1. **Worker Route** (`/api/search`): Handles the actual AutoRAG interaction
2. **MCP Tool**: Makes HTTP requests to the Worker endpoint
3. **Authentication**: Uses the same Bearer token for security

```typescript
// In the Worker (routes/search.ts)
export default new Hono().post("/", async (c) => {
  const { query, maxResults } = await c.req.json();
  
  // Access Worker-specific bindings
  const results = await c.env.AI.autorag("sentry-docs").aiSearch({
    query,
    max_num_results: maxResults,
  });
  
  return c.json({ results });
});

// In the MCP tool (tools.ts)
search_docs: async (context, params) => {
  const response = await fetch(`${context.host}/api/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${context.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  
  const data = await response.json();
  // Format and return results
}
```

This pattern works with both Cloudflare-hosted and stdio transports.

## Common Patterns

- Error handling: [error-handling.md](error-handling.md)
- API usage: `api-patterns.md`
- Testing: `testing.md`
- Response formatting: [common-patterns.md](common-patterns.md#response-formatting)

## References

- Tool examples: `packages/mcp-server/src/tools.ts`
- Schema patterns: `packages/mcp-server/src/schema.ts`
- Mock examples: `packages/mcp-server-mocks/src/handlers/`
