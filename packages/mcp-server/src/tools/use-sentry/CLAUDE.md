# use_sentry Tool - Embedded Agent Documentation

This tool embeds an AI agent (GPT-5) that can call all Sentry MCP tools to fulfill natural language requests.

## Architecture Overview

The `use_sentry` tool uses an "agent-in-tool" pattern with **in-memory MCP protocol**:

1. **MCP Tool Handler** (`handler.ts`) - Receives natural language request from calling agent
2. **In-Memory MCP Server** - Creates internal MCP server with InMemoryTransport from MCP SDK
3. **MCP Client** - Embedded agent accesses tools through MCP protocol (zero network overhead)
4. **Embedded AI Agent** (`agent.ts`) - Calls tools via MCP client to fulfill request
5. **Result Return** - Returns final results directly to calling agent

**Key Innovation**: Uses `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk` for full MCP protocol compliance without network overhead.

## Key Components

### Tool Wrapper (`tool-wrapper.ts`)

The `wrapToolForAgent()` function is a **generic wrapper** that can wrap ANY MCP tool:

```typescript
wrapToolForAgent(toolDefinition, { context })
```

**What it does:**
- Takes any MCP tool definition (from `defineTool`)
- Pre-binds the ServerContext so the agent doesn't need it
- Applies session constraints automatically (org, project, region)
- Uses `agentTool()` for automatic error handling
- Returns structured `{error?, result?}` responses

**Benefits:**
- Single implementation works for all tools
- DRY principle - no duplication per tool
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

### Generic Wrapper Pattern

The key innovation is using ONE wrapper for ALL tools:

```typescript
// Instead of 18 separate factory functions:
createWhoamiTool()
createFindOrgsTool()
createFindProjectsTool()
// ...

// We use a single generic wrapper:
wrapToolForAgent(whoamiTool, { context })
wrapToolForAgent(findOrganizationsTool, { context })
wrapToolForAgent(findProjectsTool, { context })
// ...
```

This makes the code:
- Easier to maintain (one implementation)
- More consistent (same behavior for all tools)
- Easier to extend (add new tools without new wrapper functions)

### Constraint Injection

Session constraints are automatically injected by `wrapToolForAgent()`:

```typescript
// If context.constraints.organizationSlug = "my-org"
// Agent calls: find_projects()
// Actual tool call: find_projects({ organizationSlug: "my-org" })
```

This ensures the agent respects session scope without needing to know about it.
