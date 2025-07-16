# search-events Module

This module implements the `search_events` MCP tool for natural language search across Sentry telemetry data.

## Architecture Overview

The search-events tool uses an embedded AI agent to translate natural language queries into Sentry search syntax.

## Module Structure

```
search-events/
├── index.ts                      # Export handler (public API)
├── handler.ts                    # Main tool definition and orchestration
├── agent.ts                      # AI query translation engine
├── config.ts                     # Dataset configurations and field definitions
├── formatters.ts                 # Result formatting for different datasets
├── utils.ts                      # Helper functions and utilities
└── tools/                        # AI agent tools (for embedded agent)
    └── otel-semantics-lookup.ts  # OpenTelemetry semantics lookup tool
```

## Components

- **handler.ts**: Main tool definition and orchestration
- **agent.ts**: AI query translation using OpenAI
- **config.ts**: Dataset configurations and field definitions
- **formatters.ts**: Result formatting for different datasets
- **utils.ts**: Helper functions and utilities
- **tools/otel-semantics-lookup.ts**: OpenTelemetry semantic lookup

## Data Flow

1. **Input Processing**: Natural language query received via MCP
2. **Context Building**: Fetch custom attributes and build field mappings
3. **AI Translation**: Use embedded agent to translate query to Sentry syntax
4. **Query Execution**: Execute translated query against Sentry API
5. **Result Formatting**: Format results based on dataset and query type
6. **Output**: Return formatted results with Sentry dashboard links

## OpenTelemetry Semantic Conventions

The module has deep knowledge of OpenTelemetry semantic conventions:

- **gen_ai.*** - GenAI attributes for AI/LLM/Agent calls
- **db.*** - Database attributes (STABLE in 2025)
- **http.*** - HTTP attributes (STABLE in 2025)
- **rpc.*** - RPC attributes
- **messaging.*** - Messaging system attributes
- **k8s.*** - Kubernetes attributes
- **mcp.*** - Model Context Protocol attributes (custom)

## Important Notes

- "Agent calls" refers to OpenTelemetry GenAI semantic conventions (`gen_ai.*` attributes), NOT MCP tool calls (`mcp.*` attributes)
- The AI agent validates that numeric functions only use numeric fields
- Translation failures are handled gracefully with error messages

## Usage Examples

```typescript
// Agent calls (GenAI spans)
"top 10 agent call spans by usage" → has:gen_ai.system

// MCP tool calls  
"top 10 tool call spans by usage" → has:mcp.tool.name

// Database queries
"database errors" → has:db.statement

// HTTP requests
"API call performance" → has:http.method
```

## Testing

Tests are located in `../search-events.test.ts` and `tools/otel-semantics-lookup.test.ts`.