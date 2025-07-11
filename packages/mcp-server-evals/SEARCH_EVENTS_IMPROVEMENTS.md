# Search Events Eval Improvements

## Summary

This document outlines the improvements made to the search-events evaluation tests to ensure more robust and comprehensive testing of the `search_events` tool.

## Changes Made

### 1. Enhanced Basic Eval Tests (`search-events.eval.ts`)
- Updated expected results to be more specific and check for actual query parameters
- Added validation for dataset selection (logs vs errors vs spans)
- Improved assertions to check for proper query translation

### 2. Comprehensive Eval Tests (`search-events-comprehensive.eval.ts`)
- Added `ToolUsage` scorer to ensure the tool is actually being used
- Increased timeout to 60s to handle AI query translation
- Tests now verify:
  - Correct dataset selection based on natural language
  - Query parameter extraction
  - Mock data response handling

### 3. New Enhanced Eval Suite (`search-events-enhanced.eval.ts`)
- Added 25 advanced test scenarios covering:
  - Complex time-based queries
  - User-specific filtering
  - Performance thresholds
  - Cross-service tracing
  - Boolean query combinations
  - Platform-specific issues
  - SDK filtering
  - Natural language variations

### 4. Mock Data Generator Improvements
- Enhanced query parsing to handle:
  - Quoted strings in queries
  - Wildcard operators
  - Complex boolean expressions
  - More search term extraction patterns
- Added more span templates for timeout scenarios
- Improved filtering logic for better test coverage

### 5. Validation Test Suite (`search-events-validation.eval.ts`)
- Unit tests for mock data generator functions
- Validates query parsing logic
- Ensures mock responses have correct structure
- Tests field type consistency

## Key Testing Scenarios

### Dataset Selection
- "error logs" → logs dataset with severity:error
- "exceptions/crashes" → errors dataset
- "traces/spans" → spans dataset
- "logs" → logs dataset

### Time Filtering
- Errors/Spans: Include timestamp filters (e.g., `timestamp:-1h`)
- Logs: No timestamp in query (handled by statsPeriod parameter)

### Complex Queries
- Boolean operators: AND, OR, NOT
- Field-specific filters: `user.email:`, `span.duration:>`, `error.handled:`
- Quoted strings: `"database connection failed"`
- Wildcards: `span.op:http*`

## Running the Tests

```bash
# Run all search-events evals
cd packages/mcp-server-evals
pnpm eval search-events

# Run specific eval suite
pnpm eval src/evals/search-events-enhanced.eval.ts

# Run with coverage
pnpm eval:ci
```

## Next Steps

1. Monitor eval results in CI to ensure stability
2. Add more edge cases as they're discovered
3. Consider adding performance benchmarks
4. Update mock data templates based on real-world usage patterns

## Dependencies

- Requires `OPENAI_API_KEY` environment variable for AI-powered query translation
- Uses MSW (Mock Service Worker) for API mocking
- Depends on `@sentry/mcp-server-mocks` package