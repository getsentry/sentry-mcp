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
  naturalLanguageQuery: string;  // Natural language search description
  dataset?: "spans" | "errors" | "logs"; // Dataset to search (default: "errors")
  projectSlug?: string;          // Optional - limit to specific project
  regionUrl?: string;           
  limit?: number;                // Default: 10, Max: 100
  includeExplanation?: boolean;  // Include translation explanation
}
```

### Examples

```typescript
// Find errors (errors dataset is default)
search_events({
  organizationSlug: "my-org",
  naturalLanguageQuery: "database timeouts in checkout flow from last hour"
})

// Find slow transactions
search_events({
  organizationSlug: "my-org",
  naturalLanguageQuery: "API calls taking over 5 seconds",
  projectSlug: "backend",
  dataset: "spans"
})

// Find logs
search_events({
  organizationSlug: "my-org",
  naturalLanguageQuery: "warning logs about memory usage",
  dataset: "logs"
})
```

## Architecture

1. **Tool receives** natural language query and dataset selection
2. **Fetches searchable attributes** based on dataset:
   - For `spans`/`logs`: Uses `/organizations/{org}/trace-items/attributes/` endpoint
   - For `errors`: Uses `/organizations/{org}/tags/` endpoint (legacy, will be updated)
3. **LLM agent translates** to discover endpoint parameters using:
   - Built-in knowledge of Sentry query syntax
   - Dataset-specific field mappings and query patterns
   - Custom attributes from the organization
4. **Executes** discover endpoint: `/organizations/{org}/events/` with appropriate dataset
5. **Returns** formatted results with dataset-specific fields and Sentry Explorer URL

## Key Constraints

### LLM Agent Requirements

- **System prompt** must contain comprehensive Sentry query syntax and standard fields
- **Single tool**: `find_custom_attributes(organizationSlug, projectSlug?)`
  - Returns organization's custom tags/attributes
  - Critical for queries like "errors from premium customers" → `customer_tier:premium`
  - Implementation TBD - may need to use trace/log explorer API

### Translation Output

The LLM produces a Sentry query string based on the selected dataset:

- **Spans dataset**: Focus on `span.op`, `span.description`, `span.duration`, `transaction`
- **Errors dataset**: Focus on `message`, `level`, `error.type`, `error.handled`
- **Logs dataset**: Focus on `message`, `severity`, `severity_number`

The tool automatically:
- Sets appropriate fields based on dataset
- Uses the correct API parameters (e.g., `dataset=ourlogs` for logs)
- Generates Explorer URLs pointing to the correct view (`/explore/traces/`)

### Tool Removal

- **Must remove** `find_errors` and `find_transactions` in same PR ✓
  - Removed from tool exports
  - Files still exist but are no longer used
- **Migration required** for existing usage
  - Updated `find_errors_in_file` prompt to use `search_events`
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
  naturalLanguageQuery: "unresolved errors in checkout.js"
})
```

## Implementation Notes

1. **Custom attributes API**: 
   - **Resolved**: `/organizations/{org}/trace-items/attributes/` for spans/logs
   - **Legacy**: `/organizations/{org}/tags/` for errors (TODO: migrate when new API supports errors)

2. **Dataset mapping**:
   - User specifies `logs` → API uses `ourlogs`
   - User specifies `errors` → API uses `errors`
   - User specifies `spans` → API uses `spans`

3. **URL Generation**:
   - All datasets use `/explore/traces/` path in Sentry UI
   - Query and project parameters are properly encoded

## Success Criteria

- ✅ Accurate translation of common query patterns
- ✅ Proper handling of org-specific custom attributes
- ✅ Seamless migration from old tools (find_errors, find_transactions removed)
- ✅ Maintains performance (translation overhead acceptable)
- ✅ Supports multiple datasets (spans, errors, logs)
- ✅ Generates shareable Sentry Explorer URLs
- ✅ Clear output indicating URL should be shared with end-user