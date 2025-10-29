# use_sentry Tool - Embedded Agent Documentation

This tool embeds an AI agent (GPT-5) that can call all Sentry MCP tools to fulfill natural language requests.

## Architecture Overview

The `use_sentry` tool uses an "agent-in-tool" pattern with **direct tool binding**:

1. **MCP Tool Handler** (`handler.ts`) - Receives natural language request from calling agent
2. **Tool Preparation** (`prepare-tools.ts`) - Filters and wraps tools based on scopes and constraints
3. **Embedded AI Agent** (`agent.ts`) - Directly calls prepared tools to fulfill request
4. **Result Return** - Returns final results directly to calling agent

**Key Innovation**: Uses the same filtering and wrapping logic as `buildServer` but returns tools directly without MCP protocol overhead. This provides significant performance improvements by eliminating the client-server round-trips.

## Key Components

### Tool Preparation (`prepare-tools.ts`)

The `prepareToolsForAgent()` function prepares all tools for direct use by the agent:

```typescript
prepareToolsForAgent(tools, context)
```

**What it does:**
1. Filters tools by granted scopes (same as buildServer)
2. Filters out constraint parameters from schemas
3. Wraps each tool with `agentTool` for error handling
4. Pre-binds ServerContext and injects constraints
5. Returns Vercel AI SDK compatible tools

**Benefits:**
- No MCP protocol overhead
- Same security and constraint logic as buildServer
- Direct tool execution - much faster
- Consistent error handling across all tools
- Type-safe parameter handling

### Embedded Agent (`agent.ts`)

The agent has access to ALL 19 Sentry MCP tools (20 total - use_sentry itself):

**Discovery Tools:**
- `whoami` - Get authenticated user info
- `find_organizations` - List available organizations
- `find_teams` - List teams in an organization
- `find_projects` - List projects
- `find_releases` - Find releases

**Issue Management:**
- `get_issue_details` - Get detailed issue information
- `search_issues` - Search for grouped issues
- `update_issue` - Update issue status/properties
- `analyze_issue_with_seer` - Get AI analysis of issues

**Event Analysis:**
- `search_events` - Search events with aggregations
- `get_trace_details` - Get trace information
- `get_event_attachment` - Download event attachments

**Resource Creation:**
- `create_team` - Create a new team
- `create_project` - Create a new project
- `update_project` - Update project settings
- `create_dsn` - Create a new DSN
- `find_dsns` - List project DSNs

**Documentation:**
- `search_docs` - Search Sentry documentation
- `get_doc` - Fetch full documentation pages

### Agent Behavior

**Multi-step operations:**
The agent can chain multiple tool calls:
1. Call `find_organizations` to discover orgs
2. Call `find_projects` to find specific project
3. Call `search_issues` to get issues in that project

**Constraint handling:**
- If ServerContext has `constraints.organizationSlug`, it's automatically injected
- If ServerContext has `constraints.projectSlug`, it's automatically injected
- Agent focuses on parameters that aren't pre-constrained

**Error handling:**
- Each tool returns `{error?, result?}` via `agentTool()` wrapper
- Agent can see errors and retry with corrections
- Agent can report errors to user if retry fails

## Example Request Flows

### Simple Request: "Who am I?"
```
User → use_sentry("who am I")
  → Agent calls whoami tool
  → Returns user info
```

### Complex Request: "Find unresolved issues in frontend"
```
User → use_sentry("find unresolved issues in frontend")
  → Agent calls find_projects(query="frontend")
  → Agent calls search_issues(projectSlug="frontend", query="is:unresolved")
  → Returns issues list
```

### Multi-tool Request: "Analyze the top error"
```
User → use_sentry("analyze the top error")
  → Agent calls search_issues(query="is:unresolved", sort="-count()")
  → Agent extracts top issue ID
  → Agent calls analyze_issue_with_seer(issueId="...")
  → Returns analysis
```

## Configuration

- **System Prompt**: Comprehensive guide in `config.ts`
- **Output Schema**: Simple `{ result: string }` format
- **Max Steps**: 10 (allows complex multi-tool operations)
- **Model**: GPT-5 via OpenAI (configurable via `configureOpenAIProvider`)

## Debugging

### Trace Parameter

The `trace` parameter enables visibility into the embedded agent's tool execution:

**Usage:**
```typescript
use_sentry({
  request: "what's up with https://sentry.io/issues/123",
  trace: true
})
```

**Output Format:**
When `trace: true`, the response appends a "Tool Call Trace" section showing all tool calls:

```markdown
## Tool Call Trace

### 1. get_issue_details

**Arguments:**
```json
{
  "issueUrl": "https://sentry.io/issues/123"
}
```

### 2. analyze_issue_with_seer

**Arguments:**
```json
{
  "issueId": "PROJECT-123"
}
```
```

**When to use:**
- Debugging unexpected agent behavior
- Verifying the agent calls tools correctly
- Understanding multi-step request flows
- Diagnosing parameter passing issues

## Error Handling

The tool follows MCP's single-attempt philosophy:

1. **Agent calls tools** - Multiple calls if needed
2. **Tool errors** - Returned as `{error: "..."}` to agent
3. **Agent retries** - Can adjust parameters and retry
4. **Final failure** - Agent returns clear error to user
5. **Calling agent decides** - Whether to retry the entire request

**Security:**
- All error messages are trusted (Sentry API, UserInputError, system templates)
- No prompt injection risk - errors are sanitized

## Testing

### Manual Testing

The preferred way to test the use_sentry tool is using the MCP test client:

```bash
# Test with local dev server (default: http://localhost:5173)
pnpm -w run cli --agent "who am I"

# Test against production
pnpm -w run cli --mcp-host=https://mcp.sentry.dev --agent "who am I"

# Test with local stdio mode (requires SENTRY_ACCESS_TOKEN)
pnpm -w run cli --access-token=TOKEN --agent "who am I"
```

Note: The CLI defaults to `http://localhost:5173`. Override with `--mcp-host` or set `MCP_URL` environment variable.

### Test Scenarios

- **Single tool**: "who am I" → calls whoami
- **Discovery**: "list my projects" → calls find_projects
- **Search**: "show me errors from yesterday" → calls search_events
- **Multi-step**: "find issues in frontend and analyze the top one"
- **Constrained**: With org constraint, verify agent doesn't need to provide org

## Implementation Notes

### Direct Tool Binding Pattern

The key innovation is preparing all tools at once with the same logic as `buildServer`:

```typescript
// In handler.ts:
const { use_sentry, ...toolsForAgent } = tools;
const preparedTools = prepareToolsForAgent(toolsForAgent, context);

// preparedTools now contains filtered and wrapped tools ready for agent
await useSentryAgent({ request: params.request, tools: preparedTools });
```

This makes the code:
- Much faster (no MCP protocol overhead)
- Easier to maintain (reuses buildServer logic)
- More consistent (same filtering as buildServer)
- Easier to extend (just add to tools list)

### Constraint Injection

Session constraints are automatically handled by `prepareToolsForAgent()`:

1. **Schema Filtering**: Constrained parameters are removed from tool schemas
2. **Parameter Injection**: Constraint values are injected when tools are called

```typescript
// If context.constraints.organizationSlug = "my-org"
// Agent sees: find_projects() (no organizationSlug parameter)
// Actual call: find_projects({ organizationSlug: "my-org" })
```

This ensures the agent respects session scope without needing to know about it.
