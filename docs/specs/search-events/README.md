# search_events Tool Specification

## Overview

A unified search tool that accepts natural language queries and translates them to Sentry's discover endpoint parameters. Replaces `find_errors` and `find_transactions` with a single, more flexible interface.

## Motivation

- **Current**: Two separate tools with rigid parameters, users must know Sentry query syntax
- **Proposed**: Single tool with natural language input, LLM handles translation
- **Benefit**: Better UX, reduced tool count (20 → 19)

## Interface

```typescript
interface SearchEventsParams {
  organizationSlug: string;      // Required
  semanticQuery: string;         // Natural language search description
  projectSlug?: string;          // Optional - limit to specific project
  regionUrl?: string;           
  limit?: number;                // Default: 10, Max: 100
  includeExplanation?: boolean;  // Include translation explanation
}
```

### Examples

```typescript
// Find errors
search_events({
  organizationSlug: "my-org",
  semanticQuery: "database timeouts in checkout flow from last hour"
})

// Find slow transactions
search_events({
  organizationSlug: "my-org",
  semanticQuery: "API calls taking over 5 seconds",
  projectSlug: "backend"
})
```

## Architecture

1. **Tool receives** natural language query
2. **LLM agent translates** to discover endpoint parameters using:
   - Built-in knowledge of Sentry query syntax
   - `find_custom_attributes(org, project?)` tool for org-specific fields
3. **Executes** discover endpoint: `/organizations/{org}/events/`
4. **Returns** formatted results

## Key Constraints

### LLM Agent Requirements

- **System prompt** must contain comprehensive Sentry query syntax and standard fields
- **Single tool**: `find_custom_attributes(organizationSlug, projectSlug?)`
  - Returns organization's custom tags/attributes
  - Critical for queries like "errors from premium customers" → `customer_tier:premium`
  - Implementation TBD - may need to use trace/log explorer API

### Translation Output

The LLM must produce valid discover endpoint parameters:

```typescript
{
  dataset: "errors" | "spans",  // Determines data type
  query: string,                 // Sentry query syntax
  fields: string[],              // Fields to return
  sort: string,                  // Sort order (e.g., "-last_seen")
  statsPeriod?: string,          // Time range (e.g., "24h")
}
```

### Tool Removal

- **Must remove** `find_errors` and `find_transactions` in same PR
- **Migration required** for existing usage
- **Documentation** updates needed

## Migration Examples

```typescript
// Before
find_errors({
  organizationSlug: "sentry",
  filename: "checkout.js",
  query: "is:unresolved"
})

// After
search_events({
  organizationSlug: "sentry",
  semanticQuery: "unresolved errors in checkout.js"
})
```

## Open Questions

1. **Custom attributes API**: Which endpoint returns ALL searchable attributes?
   - Current `listTags` may be insufficient
   - Need to investigate trace/log explorer implementation

2. **Parameter naming**: `semanticQuery` clearly indicates AI interpretation needed

## Success Criteria

- Accurate translation of common query patterns
- Proper handling of org-specific custom attributes
- Seamless migration from old tools
- Maintains performance (translation overhead acceptable)