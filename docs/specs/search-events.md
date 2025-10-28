# search_events Tool Specification

## Overview

A unified search tool that accepts natural language queries and translates them to Sentry's discover endpoint parameters using OpenAI GPT-5. Replaces `find_errors` and `find_transactions` with a single, more flexible interface.

## Motivation

- **Before**: Two separate tools with rigid parameters, users must know Sentry query syntax
- **After**: Single tool with natural language input, AI handles translation to Sentry syntax
- **Benefits**: Better UX, reduced tool count (20 → 19), accessible to non-technical users

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
   - For `spans`/`logs`: Uses `/organizations/{org}/trace-items/attributes/` endpoint with parallel calls for string and number attribute types
   - For `errors`: Uses `/organizations/{org}/tags/` endpoint (legacy, will migrate when new API supports errors)
3. **OpenAI GPT-5 translates** natural language to Sentry query syntax using:
   - Comprehensive system prompt with Sentry query syntax rules
   - Dataset-specific field mappings and query patterns
   - Organization's custom attributes (fetched in step 2)
4. **Executes** discover endpoint: `/organizations/{org}/events/` with:
   - Translated query string
   - Dataset-specific field selection
   - Numeric project ID (converted from slug if provided)
   - Proper dataset mapping (logs → ourlogs)
5. **Returns** formatted results with:
   - Dataset-specific rendering (console format for logs, cards for errors, timeline for spans)
   - Prominent rendering directives for AI agents
   - Shareable Sentry Explorer URL

## Key Implementation Details

### OpenAI Integration

- **Model**: GPT-5 for natural language to Sentry query translation (configurable via `configureOpenAIProvider`)
- **System prompt**: Contains comprehensive Sentry query syntax, dataset-specific rules, and available fields
- **Environment**: Requires `OPENAI_API_KEY` environment variable
- **Custom attributes**: Automatically fetched and included in system prompt for each organization

### Dataset-Specific Translation

The AI produces different query patterns based on the selected dataset:

- **Spans dataset**: Focus on `span.op`, `span.description`, `span.duration`, `transaction`, supports timestamp filters
- **Errors dataset**: Focus on `message`, `level`, `error.type`, `error.handled`, supports timestamp filters  
- **Logs dataset**: Focus on `message`, `severity`, `severity_number`, **NO timestamp filters** (uses statsPeriod instead)

### Key Technical Constraints

- **Logs timestamp handling**: Logs don't support query-based timestamp filters like `timestamp:-1h`. Instead, use `statsPeriod=24h` parameter
- **Project ID mapping**: API requires numeric project IDs, not slugs. Tool automatically converts project slugs to IDs
- **Parallel attribute fetching**: For spans/logs, fetches both string and number attribute types in parallel for better performance
- **itemType specification**: Must use "logs" (plural) not "log" for the trace-items attributes API

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

## Implementation Status

### Completed Features

1. **Custom attributes API integration**: 
   - ✅ `/organizations/{org}/trace-items/attributes/` for spans/logs with parallel string/number fetching
   - ✅ `/organizations/{org}/tags/` for errors (legacy API)

2. **Dataset mapping**:
   - ✅ User specifies `logs` → API uses `ourlogs`
   - ✅ User specifies `errors` → API uses `errors`
   - ✅ User specifies `spans` → API uses `spans`

3. **URL Generation**:
   - ✅ Uses appropriate explore path based on dataset (`/explore/traces/`, `/explore/logs/`)
   - ✅ Query and project parameters properly encoded with numeric project IDs

4. **Error Handling**:
   - ✅ Enhanced error messages with Sentry event IDs for debugging
   - ✅ Graceful handling of missing projects, API failures
   - ✅ Clear error messages for missing OpenAI API key

5. **Output Formatting**:
   - ✅ Dataset-specific rendering instructions for AI agents
   - ✅ Console format for logs with severity emojis
   - ✅ Alert cards for errors with color-coded levels
   - ✅ Performance timeline for spans with duration bars

## Success Criteria - All Complete ✅

- ✅ **Accurate translation of common query patterns** - GPT-5 with comprehensive system prompts
- ✅ **Proper handling of org-specific custom attributes** - Parallel fetching and integration
- ✅ **Seamless migration from old tools** - find_errors, find_transactions removed from exports
- ✅ **Maintains performance** - Parallel API calls, efficient caching, translation overhead minimal
- ✅ **Supports multiple datasets** - spans, errors, logs with dataset-specific handling
- ✅ **Generates shareable Sentry Explorer URLs** - Proper encoding with numeric project IDs
- ✅ **Clear output indicating URL should be shared** - Prominent sharing instructions
- ✅ **Comprehensive test coverage** - Unit tests, integration tests, and AI evaluations
- ✅ **Production ready** - Error handling, logging, graceful degradation

## Dependencies

- **Runtime**: OpenAI API key required (`OPENAI_API_KEY` environment variable)
- **Build**: @ai-sdk/openai, ai packages added to dependencies
- **Testing**: Comprehensive mocks for OpenAI and Sentry APIs