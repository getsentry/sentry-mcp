# Sentry MCP Server Mocks

This package provides comprehensive mock responses for all Sentry API endpoints used by the MCP server. Built with MSW (Mock Service Worker) for realistic HTTP interception and response handling during development and testing.

## Features

- **Dynamic Mock Data Generation**: Context-aware responses based on query parameters
- **Realistic Data Templates**: Pre-defined templates for errors, logs, and spans
- **Query Parsing**: Intelligent parsing of Sentry query syntax
- **Time-based Filtering**: Support for relative time filters (e.g., `timestamp:-1h`)
- **Field-specific Filtering**: Filter by error type, severity, user, environment, etc.

## Usage

### In Tests

```typescript
import { mswServer } from "@sentry/mcp-server-mocks";

beforeAll(() => mswServer.listen());
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

### In Development

```typescript
// Start mock server for local development
mswServer.listen();
// Now all Sentry API calls will be intercepted
```

## Mock Data Generator

The package includes a sophisticated mock data generator that creates realistic responses based on query context.

### Supported Datasets

1. **Errors Dataset** (`dataset='errors'`)
   - Exception and crash data
   - Fields: issue.id, title, error.type, error.handled, level, count(), last_seen()
   - Example queries:
     - `error.type:DatabaseError error.handled:false`
     - `level:error environment:production`

2. **Logs Dataset** (`dataset='logs'` or `dataset='ourlogs'`)
   - Application log entries
   - Fields: timestamp, message, severity, trace, sentry.item_id
   - Example queries:
     - `severity:error timestamp:-1h`
     - `memory usage severity:warning`

3. **Spans Dataset** (`dataset='spans'`)
   - Performance and trace data
   - Fields: span.op, span.description, span.duration, transaction, is_transaction
   - Example queries:
     - `span.op:db.query span.duration:>100`
     - `transaction:checkout`

### Query Syntax Support

The mock generator parses Sentry's query syntax:

- **Field filters**: `field:value` (e.g., `severity:error`)
- **Numeric comparisons**: `field:>value` (e.g., `span.duration:>100`)
- **Time filters**: `timestamp:-1h`, `timestamp:-24h`, `timestamp:-7d`
- **Boolean fields**: `error.handled:false`, `is_transaction:true`
- **Text search**: Any non-field text searches in titles/messages/descriptions

### Mock Data Templates

#### Error Templates
- DatabaseError: Connection timeout
- NullPointerException: Cannot read property 'id' of null
- AuthenticationError: Invalid credentials
- HTTPError: 500 Internal Server Error
- TimeoutError: Request timed out after 30s
- ValidationError: Missing required field 'email'
- MemoryError: JavaScript heap out of memory
- TypeError: Cannot read properties of undefined

#### Log Templates
- Info: Database connection established successfully
- Error: Failed to connect to Redis cache
- Warning: Memory usage above 80%
- Debug: Processing payment for order #12345
- Fatal: Database connection pool exhausted

#### Span Templates
- Database queries: SELECT, INSERT operations
- HTTP clients: External API calls
- Cache operations: GET, SET operations
- HTTP server transactions: API endpoints

### Response Format

All responses follow Sentry's API format:

```json
{
  "data": [...],
  "meta": {
    "fields": { "fieldName": "type" },
    "units": { "fieldName": "unit" },
    "isMetricsData": false,
    "dataset": "errors|logs|spans",
    "datasetReason": "unchanged"
  }
}
```

## Extending the Mocks

### Adding New Mock Templates

1. Add templates to the respective arrays in `mock-data-generator.ts`:
   - `ERROR_TEMPLATES`
   - `LOG_TEMPLATES`
   - `SPAN_TEMPLATES`

2. Include relevant fields that match your template's characteristics

### Adding New Query Filters

1. Update the `parseQuery` function to handle new filter syntax
2. Add filter logic to the respective generator function
3. Update the `QueryContext` interface with new filter types

### Example: Adding a New Error Type

```typescript
// In ERROR_TEMPLATES array
{
  title: "RateLimitError: API rate limit exceeded",
  "error.type": "RateLimitError",
  "error.handled": true,
  level: "warning",
}
```

## Best Practices

1. **Realistic Data**: Use realistic values that match production patterns
2. **Consistent IDs**: Generate consistent ID formats (e.g., `CLOUDFLARE-MCP-XX`)
3. **Time Ranges**: Respect time filters in queries
4. **Field Matching**: Ensure generated data matches requested fields
5. **Result Counts**: Vary result counts based on query specificity:
   - Specific queries (3+ filters): 1-5 results
   - General queries (1-2 filters): 5-15 results
   - No filters: 10-20 results

## Testing

The mock system is tested through:
- Unit tests for query parsing
- Integration tests with the MCP server
- Eval tests that verify AI agent behavior

## Troubleshooting

### No Results Returned
- Check if filters are too restrictive
- Verify the dataset matches your query intent
- Ensure time filters include recent data

### Wrong Dataset Selected
- "error logs" → use `dataset='logs'` with `severity:error`
- "exceptions/crashes" → use `dataset='errors'`
- "traces/performance" → use `dataset='spans'`

### Field Type Mismatches
- Numeric fields need numeric comparisons: `span.duration:>100`
- Boolean fields need boolean values: `error.handled:false`
- Text fields support partial matching