# search-events Module

This module implements the `search_events` MCP tool for natural language search across Sentry telemetry data.

## Architecture Overview

The search-events tool uses an **embedded AI agent** to translate natural language queries into Sentry search syntax. The agent has access to OpenTelemetry semantic conventions and can dynamically look up attribute patterns.

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

## Key Components

### 1. handler.ts - Main Tool Definition
- **Purpose**: Defines the MCP tool with input schema and main handler logic
- **Responsibilities**:
  - Project ID resolution
  - Custom attribute fetching
  - Field type validation
  - API calls to Sentry
  - Result formatting orchestration

### 2. agent.ts - AI Query Translation Engine
- **Purpose**: Translates natural language to Sentry search syntax using OpenAI
- **Key Features**:
  - System prompt building with dataset-specific rules
  - Dynamic semantic enhancement based on query content
  - Structured response validation
  - Error handling for AI failures

### 3. config.ts - Dataset Configurations
- **Purpose**: Centralized configuration for different Sentry datasets
- **Contains**:
  - Base common fields across all datasets
  - Dataset-specific field definitions (errors, logs, spans)
  - Numeric field mappings for aggregate functions
  - Dataset-specific rules and examples
  - Recommended field sets for each dataset

### 4. formatters.ts - Result Formatting
- **Purpose**: Format query results for different datasets and query types
- **Responsibilities**:
  - Error result formatting (with issue links)
  - Log result formatting (console-style with severity colors)
  - Span result formatting (performance timeline style)
  - Aggregate vs individual result handling

### 5. utils.ts - Helper Functions
- **Purpose**: Shared utility functions
- **Contains**:
  - Safe value extraction from event data
  - Aggregate query detection
  - Custom attribute fetching from Sentry APIs

### 6. tools/otel-semantics-lookup.ts - AI Agent Tool
- **Purpose**: OpenTelemetry semantic convention lookup for the embedded agent
- **Key Features**:
  - Pattern matching for common query terms (agent, database, http, etc.)
  - Dynamic attribute lookup from Sentry APIs
  - System prompt enhancement with semantic guidance

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

## AI Agent Integration

The embedded AI agent is enhanced with:

1. **Dynamic Prompt Enhancement**: Query content triggers semantic guidance
2. **Attribute Discovery**: Can lookup attributes from live Sentry data
3. **Validation**: Ensures numeric functions only use numeric fields
4. **Error Recovery**: Handles AI translation failures gracefully

## Key Insight: Agent vs Tool Disambiguation

**Critical**: When users ask for "agent calls", this maps to OpenTelemetry GenAI semantic conventions (`gen_ai.*` attributes), NOT MCP tool calls (`mcp.*` attributes). The semantic lookup tool ensures proper disambiguation.

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

Tests are located in `../search-events.test.ts` and cover:
- AI query translation
- Field validation
- Result formatting
- Error handling
- Mock API responses

## Future Enhancements

- Additional semantic convention namespaces
- Enhanced AI agent tools
- Performance optimizations
- Extended dataset support