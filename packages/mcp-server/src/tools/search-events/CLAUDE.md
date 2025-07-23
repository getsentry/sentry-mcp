# search_events Tool - Embedded Agent Documentation

This tool embeds an AI agent (GPT-4o) to translate natural language queries into Sentry's event search syntax.

## Architecture Overview

The `search_events` tool uses an "agent-in-tool" pattern:

1. **MCP Tool Handler** (`handler.ts`) - Receives natural language query from calling agent
2. **Embedded AI Agent** (`agent.ts`) - Translates to Sentry search syntax 
3. **API Execution** - Runs the translated query against Sentry's API
4. **Result Formatting** - Returns formatted results to calling agent

## Embedded Agent Behavior

### Available Tools

The embedded agent has access to three tools:

1. **datasetAttributes** - Discovers available fields for the chosen dataset
2. **otelSemantics** - Looks up OpenTelemetry semantic conventions
3. **whoami** - Resolves "me" references to actual user IDs

### Translation Flow

1. Analyzes natural language query to determine dataset (spans/errors/logs)
2. Calls `datasetAttributes` to discover available fields
3. May call `otelSemantics` for standardized field names
4. Generates structured query with fields, sort, and timeRange

### Key Query Patterns

#### Distinct/Unique Values
- "distinct tool names" → `fields: ['mcp.tool.name', 'count()'], sort: '-count()'`
- Always uses aggregate mode with count()

#### Traffic/Volume Queries  
- "how much traffic" → `fields: ['count()'], sort: '-count()'`
- "traffic by X" → `fields: ['X', 'count()'], sort: '-count()'`

#### Mathematical Queries
- "total tokens used" → `fields: ['sum(gen_ai.usage.input_tokens)', 'sum(gen_ai.usage.output_tokens)']`
- Uses spans dataset for OpenTelemetry metrics

#### Time Series (NOT SUPPORTED)
- "X over time" → Returns error: "Time series aggregations are not currently supported."

## Error Handling

The tool follows the MCP philosophy of single-attempt error handling:

1. **Agent generates query** - Using static system prompt
2. **Validation Error** - Returns clear UserInputError to calling agent
3. **Calling agent decides** - Whether to retry with corrections

Common validation errors:
- Missing sort parameter
- Sort field not included in fields array
- Missing fields for aggregate queries
- Invalid field names or syntax

This approach enables better LLM prompt caching and cleaner error boundaries.

## Limitations

1. **No Time Series** - Cannot do "over time" aggregations
2. **Dataset Constraints**:
   - Equations only work in spans dataset
   - Numeric aggregations limited by field types
   - Timestamp filtering differs between datasets
3. **Project Scope** - Fields vary by project based on instrumented data

## Common Issues and Solutions

### Issue: "Sort field not in fields array"
**Cause**: Agent specified sort by a field not included in the fields array
**Solution**: Error message guides agent to include the sort field

### Issue: "Time series not supported"
**Cause**: User asked for data "over time"
**Solution**: Return clear error message, no retry

### Issue: "Invalid aggregate function on non-numeric field"
**Cause**: Using avg(), sum() etc. on string fields
**Solution**: Agent uses field type information from datasetAttributes

## Testing Queries

Test various query patterns:
- Simple counts: "how many errors today"
- Distinct values: "distinct user agents"
- Grouped aggregations: "errors by type"
- Token usage: "total tokens used by model"
- Time-filtered: "errors in the last hour"

## Future Improvements

1. ~~Consider removing retry mechanism - let calling agent handle retries~~ ✅ Done
2. Add support for time bucketing fields (timestamp.to_hour, timestamp.to_day)
3. Extract createOtelLookupTool and createDatasetAttributesTool to shared modules