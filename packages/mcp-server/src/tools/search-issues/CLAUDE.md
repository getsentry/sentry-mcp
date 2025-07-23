# search_issues Tool - Embedded Agent Documentation

This tool embeds an AI agent (GPT-4o) to translate natural language queries into Sentry's issue search syntax.

## Architecture Overview

The `search_issues` tool uses an "agent-in-tool" pattern similar to `search_events`:

1. **MCP Tool Handler** (`handler.ts`) - Receives natural language query from calling agent
2. **Embedded AI Agent** (`agent.ts`) - Translates to Sentry issue search syntax
3. **API Execution** - Runs the translated query against Sentry's API
4. **Result Formatting** - Returns formatted grouped issues to calling agent

## Key Differences from search_events

### Purpose
- `search_events`: Returns individual events or aggregated statistics
- `search_issues`: Returns grouped issues (problems) with metadata

### Query Syntax
- Uses Sentry's issue search syntax (different from event search)
- No aggregate functions - issues are already grouped
- Special fields like `is:`, `assigned:`, `firstSeen:`, `lastSeen:`

### No Datasets
- Issues are a single unified view across all event types
- No dataset selection required

## Embedded Agent Behavior

### Available Tools

The embedded agent has access to two tools:

1. **discoverDatasetFields** - Discovers available issue fields
2. **whoami** - Resolves "me" references to actual user IDs

### Translation Flow

1. Analyzes natural language query for issue-specific patterns
2. Calls `discoverDatasetFields` to get available issue fields
3. May call `whoami` to resolve "me" references
4. Generates issue search query with proper syntax

### Key Query Patterns

#### Status Queries
- "unresolved issues" → `is:unresolved`
- "ignored bugs" → `is:ignored`
- "resolved yesterday" → `is:resolved` + timeRange

#### Assignment Queries
- "issues assigned to me" → `assigned:me` (or resolved email)
- "unassigned errors" → `is:unassigned`

#### Impact Queries
- "issues affecting 100+ users" → `users:>100`
- "high volume errors" → `events:>1000`

#### Time-based Queries
- "issues from last week" → Uses timeRange parameter
- "errors seen today" → `lastSeen:-24h`

## Error Handling

Follows the same MCP philosophy as search_events:

1. **Agent generates query** - Using static system prompt
2. **Validation Error** - Returns clear UserInputError to calling agent
3. **Calling agent decides** - Whether to retry with corrections

Common validation errors:
- Invalid issue field names
- Incorrect query syntax
- Missing required parameters

This approach enables better LLM prompt caching and cleaner error boundaries.

## Issue-Specific Fields

### Status Fields
- `is:` - resolved, unresolved, ignored, archived
- `assigned:` - user email or "me"
- `bookmarks:` - user email

### Time Fields  
- `firstSeen:` - When issue was first seen
- `lastSeen:` - When issue was last seen
- `age:` - How old the issue is

### Impact Fields
- `users:` - Number of affected users
- `events:` - Total event count
- `level:` - error, warning, info, debug

## Limitations

1. **No Aggregations** - Issues are already grouped, no count()/sum()
2. **Limited Operators** - Simpler query syntax than events
3. **No Custom Fields** - Fixed set of issue attributes

## Common Issues and Solutions

### Issue: "Using event syntax for issues"
**Cause**: Agent tries to use event search patterns
**Solution**: Clear separation in prompt between issue and event search

### Issue: "Me resolution failures"
**Cause**: User not authenticated or API error
**Solution**: Fallback to suggesting user provide email

## Testing Queries

Test various issue query patterns:
- Status filters: "unresolved critical errors"
- Assignment: "my issues", "unassigned bugs"
- Impact: "issues affecting many users"
- Time ranges: "issues from yesterday"
- Combined: "unresolved errors assigned to me from last week"

## Future Improvements

1. ~~Consider removing retry mechanism - let calling agent handle retries~~ ✅ Done
2. Better integration with issue workflow commands (resolve, assign)
3. Extract shared agent tools to common module