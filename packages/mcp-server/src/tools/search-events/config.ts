// Build a dataset-agnostic system prompt
export const systemPrompt = `You are a Sentry query translator. You need to:
1. FIRST determine which dataset (spans, errors, or logs) is most appropriate for the query
2. Query the available attributes for that dataset using the datasetAttributes tool
3. Use the otelSemantics tool if you need OpenTelemetry semantic conventions
4. Convert the natural language query to Sentry's search syntax (NOT SQL syntax)
5. Decide which fields to return in the results

CRITICAL: Sentry does NOT use SQL syntax. Do NOT generate SQL-like queries.

DATASET SELECTION GUIDELINES:
- spans: Performance data, traces, AI/LLM calls, database queries, HTTP requests, token usage, costs, duration metrics, user agent data, "XYZ calls", ambiguous operations (richest attribute set)
- errors: Exceptions, crashes, error messages, stack traces, unhandled errors, browser/client errors
- logs: Log entries, log messages, severity levels, debugging information

For ambiguous queries like "calls using XYZ", prefer spans dataset first as it contains the most comprehensive telemetry data.

CRITICAL - FIELD VERIFICATION REQUIREMENT:
Before constructing ANY query, you MUST verify field availability:
1. You CANNOT assume ANY field exists without checking - not even common ones
2. This includes ALL fields: custom attributes, database fields, HTTP fields, AI fields, user fields, etc.
3. Fields vary by project based on what data is being sent to Sentry
4. Using an unverified field WILL cause your query to fail with "field not found" errors
5. The datasetAttributes tool tells you EXACTLY which fields are available

TOOL USAGE GUIDELINES:
1. Use datasetAttributes tool to discover available fields for your chosen dataset
2. Use otelSemantics tool when you need specific OpenTelemetry semantic convention attributes
3. Use whoami tool when queries contain "me" references for user.id or user.email fields
4. IMPORTANT: For ambiguous terms like "user agents", "browser", "client" - use the datasetAttributes tool to find the correct field name (typically user_agent.original) instead of assuming it's related to user.id

CRITICAL - HANDLING "DISTINCT" OR "UNIQUE VALUES" QUERIES:
When user asks for "distinct", "unique", "all values of", or "what are the X" queries:
1. This ALWAYS requires an AGGREGATE query with count() function
2. Pattern: fields=['field_name', 'count()'] to show distinct values with counts
3. Sort by "-count()" to show most common values first
4. Use datasetAttributes tool to verify the field exists before constructing query
5. Examples:
   - "distinct categories" → fields=['category.name', 'count()'], sort='-count()'
   - "unique types" → fields=['item.type', 'count()'], sort='-count()'

CRITICAL - TRAFFIC/VOLUME/COUNT QUERIES:
When user asks about "traffic", "volume", "how much", "how many" (without specific metrics):
1. This ALWAYS requires an AGGREGATE query with count() function
2. For total counts: fields=['count()']
3. For grouped counts: fields=['grouping_field', 'count()']
4. Always include timeRange for period-specific queries
5. Examples:
   - "how much traffic in last 30 days" → fields=['count()'], timeRange: {"statsPeriod": "30d"}
   - "traffic on mcp-server" → query: "project:mcp-server", fields=['count()']

CRITICAL - HANDLING "ME" REFERENCES:
- If the query contains "me", "my", "myself", or "affecting me" in the context of user.id or user.email fields, use the whoami tool to get the user's ID and email
- For assignedTo fields, you can use "me" directly without translation (e.g., assignedTo:me works as-is)
- After calling whoami, replace "me" references with the actual user.id or user.email values
- If whoami fails, return an error explaining the issue

QUERY MODES:
1. INDIVIDUAL EVENTS (default): Returns raw event data
   - Used when fields contain no function() calls
   - Include recommended fields plus any user-requested fields

2. AGGREGATE QUERIES: Grouping and aggregation (NOT SQL)
   - Activated when ANY field contains a function() call
   - Fields should ONLY include: aggregate functions + groupBy fields
   - Automatically groups by ALL non-function fields
   - For aggregate queries, ONLY include the aggregate functions and groupBy fields - do NOT include default fields like timestamp, id, etc.
   - You SHOULD sort aggregate results by "-function_name()" for descending order (highest values first)
   - For equations in aggregate queries: You SHOULD use "-equation|..." prefix unless user wants lowest values
   - When user asks "how many total", "sum of", or similar: They want the highest/total value, use descending sort

CRITICAL LIMITATION - TIME SERIES NOT SUPPORTED:
- Queries asking for data "over time", "by hour", "by day", "time series", or similar temporal groupings are NOT currently supported
- If user asks for "X over time", return an error explaining: "Time series aggregations are not currently supported."

CRITICAL - DO NOT USE SQL SYNTAX:
- NEVER use SQL functions like yesterday(), today(), now(), IS NOT NULL, IS NULL
- NEVER use SQL date functions - use timeRange parameter instead
- For "yesterday": Use timeRange: {"statsPeriod": "24h"}, NOT timestamp >= yesterday()
- For field existence: Use has:field_name, NOT field_name IS NOT NULL
- For field absence: Use !has:field_name, NOT field_name IS NULL

MATHEMATICAL QUERY PATTERNS:
When user asks mathematical questions like "how many X", "total Y used", "sum of Z":
- Identify the appropriate dataset based on context
- Use datasetAttributes tool to find available numeric fields
- Use sum() function for totals, avg() for averages, count() for counts
- For time-based queries ("today", "yesterday", "this week"), use timeRange parameter
- For "total" or "how many" questions: Users typically want highest values first (descending sort)

DERIVED METRICS AND CALCULATIONS (SPANS ONLY):
When user asks for calculated metrics, ratios, or conversions:
- Use equation fields with "equation|" prefix
- Examples:
  - "duration in milliseconds" → fields: ["equation|avg(span.duration) * 1000"], sort: "-equation|avg(span.duration) * 1000"
  - "combined metric total" → fields: ["equation|sum(metric.a) + sum(metric.b)"], sort: "-equation|sum(metric.a) + sum(metric.b)"
  - "error rate percentage" → fields: ["equation|failure_rate() * 100"], sort: "-equation|failure_rate() * 100"
  - "events per second" → fields: ["equation|count() / 3600"], sort: "-equation|count() / 3600"
- IMPORTANT: Equations are ONLY supported in the spans dataset, NOT in errors or logs
- IMPORTANT: When sorting by equations, use "-equation|..." for descending order (highest values first)

SORTING RULES (CRITICAL - YOU MUST ALWAYS SPECIFY A SORT):
1. CRITICAL: Sort MUST go in the separate "sort" field, NEVER in the "query" field
   - WRONG: query: "level:error sort:-timestamp" ← Sort syntax in query field is FORBIDDEN
   - CORRECT: query: "level:error", sort: "-timestamp" ← Sort in separate field

2. DEFAULT SORTING:
   - errors dataset: Use "-timestamp" (newest first)
   - spans dataset: Use "-span.duration" (slowest first)  
   - logs dataset: Use "-timestamp" (newest first)

3. SORTING SYNTAX:
   - Use "-" prefix for descending order (e.g., "-timestamp" for newest first)
   - Use field name without prefix for ascending order
   - For aggregate queries: sort by aggregate function results (e.g., "-count()" for highest count first)
   - For equation fields: You SHOULD use "-equation|..." for descending order (e.g., "-equation|sum(field1) + sum(field2)")
   - Only omit the "-" prefix if the user clearly wants lowest values first (rare)

4. IMPORTANT SORTING REQUIREMENTS:
   - YOU MUST ALWAYS INCLUDE A SORT PARAMETER
   - CRITICAL: The field you sort by MUST be included in your fields array
   - If sorting by "-timestamp", include "timestamp" in fields
   - If sorting by "-count()", include "count()" in fields
   - This is MANDATORY - Sentry will reject queries where sort field is not in the selected fields

YOUR RESPONSE FORMAT:
Return a JSON object with these fields:
- "dataset": Which dataset you determined to use ("spans", "errors", or "logs")
- "query": The Sentry query string for filtering results (use empty string "" for no filters)
- "fields": Array of field names to return in results
  - For individual event queries: OPTIONAL (will use recommended fields if not provided)
  - For aggregate queries: REQUIRED (must include aggregate functions AND any groupBy fields)
- "sort": Sort parameter for results (REQUIRED - YOU MUST ALWAYS SPECIFY THIS)
- "timeRange": Time range parameters (optional)
  - Relative: {"statsPeriod": "24h"} for last 24 hours, "7d" for last 7 days, etc.
  - Absolute: {"start": "2025-06-19T07:00:00", "end": "2025-06-20T06:59:59"} for specific date ranges

CORRECT QUERY PATTERNS (FOLLOW THESE):
- For field existence: Use has:field_name (NOT field_name IS NOT NULL)
- For field absence: Use !has:field_name (NOT field_name IS NULL)
- For time periods: Use timeRange parameter (NOT SQL date functions)
- Example: "items processed yesterday" → query: "has:item.processed", timeRange: {"statsPeriod": "24h"}

PROCESS:
1. Analyze the user's query
2. Determine appropriate dataset
3. Use datasetAttributes tool to discover available fields
4. Use otelSemantics tool if needed for OpenTelemetry attributes
5. Construct the final query with proper fields and sort parameters

COMMON ERRORS TO AVOID:
- Using SQL syntax (IS NOT NULL, IS NULL, yesterday(), today(), etc.) - Use has: operator and timeRange instead
- Using numeric functions (sum, avg, min, max, percentiles) on non-numeric fields
- Using incorrect field names (use the otelSemantics tool to look up correct names)
- Missing required fields in the fields array for aggregate queries
- Invalid sort parameter not included in fields array
- For field existence: Use has:field_name (NOT field_name IS NOT NULL)
- For field absence: Use !has:field_name (NOT field_name IS NULL)
- For time periods: Use timeRange parameter (NOT SQL date functions like yesterday())`;

// Base fields common to all datasets
export const BASE_COMMON_FIELDS = {
  project: "Project slug",
  timestamp: "When the event occurred",
  environment: "Environment (production, staging, development)",
  release: "Release version",
  platform: "Platform (javascript, python, etc.)",
  "user.id": "User ID",
  "user.email": "User email",
  "sdk.name": "SDK name",
  "sdk.version": "SDK version",
};

// Known numeric fields for each dataset
export const NUMERIC_FIELDS: Record<string, Set<string>> = {
  spans: new Set([
    "span.duration",
    "span.self_time",
    "transaction.duration",
    "http.status_code",
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens",
    "gen_ai.request.max_tokens",
  ]),
  errors: new Set([
    // Most error fields are strings/categories
    "stack.lineno",
  ]),
  logs: new Set(["severity_number", "sentry.observed_timestamp_nanos"]),
};

// Dataset-specific field definitions
export const DATASET_FIELDS = {
  spans: {
    // Span-specific fields
    "span.op": "Span operation type (e.g., http.client, db.query, cache.get)",
    "span.description": "Detailed description of the span operation",
    "span.duration": "Duration of the span in milliseconds",
    "span.status": "Span status (ok, cancelled, unknown, etc.)",
    "span.self_time": "Time spent in this span excluding child spans",

    // Transaction fields
    transaction: "Transaction name/route",
    "transaction.duration": "Total transaction duration in milliseconds",
    "transaction.op": "Transaction operation type",
    "transaction.status": "Transaction status",
    is_transaction: "Whether this span is a transaction (true/false)",

    // Trace fields
    trace: "Trace ID",
    "trace.span_id": "Span ID within the trace",
    "trace.parent_span_id": "Parent span ID",

    // HTTP fields
    "http.method": "HTTP method (GET, POST, etc.)",
    "http.status_code": "HTTP response status code",
    "http.url": "Full HTTP URL",

    // Database fields
    "db.system": "Database system (postgresql, mysql, etc.)",
    "db.operation": "Database operation (SELECT, INSERT, etc.)",

    // OpenTelemetry attribute namespaces for semantic queries
    // Use has:namespace.* to find spans with any attribute in that namespace
    // GenAI namespace (gen_ai.*) - for AI/LLM/Agent calls
    "gen_ai.system": "AI system (e.g., anthropic, openai)",
    "gen_ai.request.model": "Model name (e.g., claude-3-5-sonnet-20241022)",
    "gen_ai.operation.name": "Operation type (e.g., chat, completion)",
    "gen_ai.usage.input_tokens": "Number of input tokens (numeric)",
    "gen_ai.usage.output_tokens": "Number of output tokens (numeric)",

    // MCP namespace (mcp.*) - for Model Context Protocol tool calls
    "mcp.tool.name": "Tool name (e.g., search_issues, search_events)",
    "mcp.session.id": "MCP session identifier",

    // Aggregate functions (SPANS dataset only - require numeric fields except count/count_unique)
    "count()": "Count of spans",
    "count_unique(field)": "Count of unique values, e.g. count_unique(user.id)",
    "avg(field)": "Average of numeric field, e.g. avg(span.duration)",
    "sum(field)": "Sum of numeric field, e.g. sum(span.self_time)",
    "min(field)": "Minimum of numeric field, e.g. min(span.duration)",
    "max(field)": "Maximum of numeric field, e.g. max(span.duration)",
    "p50(field)": "50th percentile (median), e.g. p50(span.duration)",
    "p75(field)": "75th percentile, e.g. p75(span.duration)",
    "p90(field)": "90th percentile, e.g. p90(span.duration)",
    "p95(field)": "95th percentile, e.g. p95(span.duration)",
    "p99(field)": "99th percentile, e.g. p99(span.duration)",
    "p100(field)": "100th percentile (max), e.g. p100(span.duration)",
    "epm()": "Events per minute rate",
    "failure_rate()": "Percentage of failed spans",
  },
  errors: {
    // Error-specific fields
    message: "Error message",
    level: "Error level (error, warning, info, debug)",
    "error.type": "Error type/exception class",
    "error.value": "Error value/description",
    "error.handled": "Whether the error was handled (true/false)",
    culprit: "Code location that caused the error",
    title: "Error title/grouping",

    // Stack trace fields
    "stack.filename": "File where error occurred",
    "stack.function": "Function where error occurred",
    "stack.module": "Module where error occurred",
    "stack.abs_path": "Absolute path to file",

    // Additional context fields
    "os.name": "Operating system name",
    "browser.name": "Browser name",
    "device.family": "Device family",

    // Aggregate functions (ERRORS dataset only)
    "count()": "Count of error events",
    "count_unique(field)": "Count of unique values, e.g. count_unique(user.id)",
    "count_if(field,equals,value)":
      "Conditional count, e.g. count_if(error.handled,equals,false)",
    "last_seen()": "Most recent timestamp of the group",
    "eps()": "Events per second rate",
    "epm()": "Events per minute rate",
  },
  logs: {
    // Log-specific fields
    message: "Log message",
    severity: "Log severity level",
    severity_number: "Numeric severity level",
    "sentry.item_id": "Sentry item ID",
    "sentry.observed_timestamp_nanos": "Observed timestamp in nanoseconds",

    // Trace context
    trace: "Trace ID",

    // Aggregate functions (LOGS dataset only - require numeric fields except count/count_unique)
    "count()": "Count of log entries",
    "count_unique(field)": "Count of unique values, e.g. count_unique(user.id)",
    "avg(field)": "Average of numeric field, e.g. avg(severity_number)",
    "sum(field)": "Sum of numeric field",
    "min(field)": "Minimum of numeric field",
    "max(field)": "Maximum of numeric field",
    "p50(field)": "50th percentile (median)",
    "p75(field)": "75th percentile",
    "p90(field)": "90th percentile",
    "p95(field)": "95th percentile",
    "p99(field)": "99th percentile",
    "p100(field)": "100th percentile (max)",
    "epm()": "Events per minute rate",
  },
};

// Dataset-specific rules and examples
export const DATASET_CONFIGS = {
  errors: {
    rules: `- For errors, focus on: message, level, error.type, error.handled
- Use level field for severity (error, warning, info, debug)
- Use error.handled:false for unhandled exceptions/crashes
- For filename searches: Use stack.filename for suffix-based search (e.g., stack.filename:"**/index.js" or stack.filename:"**/components/Button.tsx")
- When searching for errors in specific files, prefer including the parent folder to avoid ambiguity (e.g., stack.filename:"**/components/index.js" instead of just stack.filename:"**/index.js")`,
    examples: `- "null pointer exceptions" → 
  {
    "query": "error.type:\\"NullPointerException\\" OR message:\\"*null pointer*\\"",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit"],
    "sort": "-timestamp"
  }
- "unhandled errors in production" → 
  {
    "query": "error.handled:false AND environment:production",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit", "error.handled", "environment"],
    "sort": "-timestamp"
  }
- "database connection errors" → 
  {
    "query": "message:\\"*database*\\" AND message:\\"*connection*\\" AND level:error",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit"],
    "sort": "-timestamp"
  }
- "show me user emails for authentication failures" → 
  {
    "query": "message:\\"*auth*\\" AND (message:\\"*failed*\\" OR message:\\"*denied*\\")",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit", "user.email"],
    "sort": "-timestamp"
  }
- "errors in Button.tsx file" → 
  {
    "query": "stack.filename:\\"**/Button.tsx\\"",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit", "stack.filename"],
    "sort": "-timestamp"
  }
- "count errors by type in production" → 
  {
    "query": "environment:production",
    "fields": ["error.type", "count()", "last_seen()"],
    "sort": "-count()"
  }
- "most common errors last 24h" → 
  {
    "query": "level:error",
    "fields": ["title", "error.type", "count()"],
    "sort": "-count()"
  }
- "unhandled errors rate by project" → 
  {
    "query": "",
    "fields": ["project", "count()", "count_if(error.handled,equals,false)", "epm()"],
    "sort": "-count()"
  }
- "errors in the last hour" → 
  {
    "query": "",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit"],
    "sort": "-timestamp",
    "timeRange": {"statsPeriod": "1h"}
  }
- "database errors between June 19-20" → 
  {
    "query": "message:\\"*database*\\"",
    "fields": ["issue", "title", "project", "timestamp", "level", "message", "error.type", "culprit"],
    "sort": "-timestamp",
    "timeRange": {"start": "2025-06-19T00:00:00", "end": "2025-06-20T23:59:59"}
  }
- "unique users affected by errors" → 
  {
    "query": "level:error",
    "fields": ["error.type", "count()", "count_unique(user.id)"],
    "sort": "-count_unique(user.id)"
  }
- "what is the most common error" → 
  {
    "query": "",
    "fields": ["title", "count()"],
    "sort": "-count()"
  }
- "errors by browser" → 
  {
    "query": "has:user_agent.original",
    "fields": ["user_agent.original", "count()"],
    "sort": "-count()"
  }
- "which user agents have the most errors" → 
  {
    "query": "level:error AND has:user_agent.original",
    "fields": ["user_agent.original", "count()", "count_unique(user.id)"],
    "sort": "-count()"
  }`,
  },
  logs: {
    rules: `- For logs, focus on: message, severity, severity_number
- Use severity field for log levels (fatal, error, warning, info, debug, trace)
- severity_number is numeric (21=fatal, 17=error, 13=warning, 9=info, 5=debug, 1=trace)
- IMPORTANT: For time-based filtering in logs, do NOT use timestamp filters in the query
- Instead, time filtering for logs is handled by the statsPeriod parameter (not part of the query string)
- Keep your query focused on message content, severity levels, and other attributes only
- When user asks for "error logs", interpret this as logs with severity:error`,
    examples: `- "warning logs about memory" → 
  {
    "query": "severity:warning AND message:\\"*memory*\\"",
    "fields": ["timestamp", "project", "message", "severity", "trace"],
    "sort": "-timestamp"
  }
- "error logs from database" → 
  {
    "query": "severity:error AND message:\\"*database*\\"",
    "fields": ["timestamp", "project", "message", "severity", "trace"],
    "sort": "-timestamp"
  }
- "show me error logs with user context" → 
  {
    "query": "severity:error",
    "fields": ["timestamp", "project", "message", "severity", "trace", "user.id", "user.email"],
    "sort": "-timestamp"
  }
- "what is the most common log" → 
  {
    "query": "",
    "fields": ["message", "count()"],
    "sort": "-count()"
  }
- "most common error logs" → 
  {
    "query": "severity:error",
    "fields": ["message", "count()"],
    "sort": "-count()"
  }
- "count logs by severity" → 
  {
    "query": "",
    "fields": ["severity", "count()"],
    "sort": "-count()"
  }
- "log volume by project" → 
  {
    "query": "",
    "fields": ["project", "count()", "epm()"],
    "sort": "-count()"
  }`,
  },
  spans: {
    rules: `- For traces/spans, focus on: span.op, span.description, span.duration, transaction
- Use is_transaction:true for transaction spans only
- Use span.duration for performance queries (value is in milliseconds)
- IMPORTANT: Use has: queries for attribute-based filtering instead of span.op patterns:
  - For HTTP requests: use "has:request.url" instead of "span.op:http*"
  - For database queries: use "has:db.statement" or "has:db.system" instead of "span.op:db*"
  - For AI/LLM/Agent calls: use "has:gen_ai.system" or "has:gen_ai.request.model" (OpenTelemetry GenAI semantic conventions)
  - For MCP tool calls: use "has:mcp.tool.name" (Model Context Protocol semantic conventions)
  - This approach is more flexible and captures all relevant spans regardless of their operation type

OpenTelemetry Semantic Conventions (2025 Stable):
Core Namespaces:
- gen_ai.*: GenAI attributes for AI/LLM/Agent calls (system, request.model, operation.name, usage.*)
- db.*: Database attributes (system, statement, operation, name) - STABLE
- http.*: HTTP attributes (method, status_code, url, request.*, response.*) - STABLE
- rpc.*: RPC attributes (system, service, method, grpc.*)
- messaging.*: Messaging attributes (system, operation, destination.*)
- faas.*: Function as a Service attributes (name, version, runtime)
- cloud.*: Cloud provider attributes (provider, region, zone)
- k8s.*: Kubernetes attributes (namespace, pod, container, node)
- host.*: Host attributes (name, type, arch, os.*)
- service.*: Service attributes (name, version, instance.id)
- process.*: Process attributes (pid, command, runtime.*)

Custom Namespaces:
- mcp.*: Model Context Protocol attributes for MCP tool calls (tool.name, session.id, transport)

Query Patterns:
- Use has:namespace.* to find spans with any attribute in that namespace
- Most common: has:gen_ai.system (agent calls), has:mcp.tool.name (MCP tools), has:db.statement (database), has:http.method (HTTP)`,
    examples: `- "database queries" → 
  {
    "query": "has:db.statement",
    "fields": ["span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace", "db.system", "db.statement"],
    "sort": "-span.duration"
  }
- "slow API calls over 5 seconds" → 
  {
    "query": "has:request.url AND span.duration:>5000",
    "fields": ["span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace", "request.url", "request.method", "span.status_code"],
    "sort": "-span.duration"
  }
- "show me database queries with their SQL" → 
  {
    "query": "has:db.statement",
    "fields": ["span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace", "db.system", "db.statement"],
    "sort": "-span.duration"
  }
- "average response time by endpoint" → 
  {
    "query": "is_transaction:true",
    "fields": ["transaction", "count()", "avg(span.duration)", "p95(span.duration)"],
    "sort": "-avg(span.duration)"
  }
- "slowest database queries by p95" → 
  {
    "query": "has:db.statement",
    "fields": ["db.statement", "count()", "p50(span.duration)", "p95(span.duration)", "max(span.duration)"],
    "sort": "-p95(span.duration)"
  }
- "API calls in the last 30 minutes" → 
  {
    "query": "has:request.url",
    "fields": ["id", "span.op", "span.description", "span.duration", "transaction", "timestamp", "project", "trace", "request.url", "request.method"],
    "sort": "-timestamp",
    "timeRange": {"statsPeriod": "30m"}
  }
- "most common transaction" → 
  {
    "query": "is_transaction:true",
    "fields": ["transaction", "count()"],
    "sort": "-count()"
  }
- "top 10 tool call spans by usage" → 
  {
    "query": "has:mcp.tool.name",
    "fields": ["mcp.tool.name", "count()"],
    "sort": "-count()"
  }
- "top 10 agent call spans by usage" → 
  {
    "query": "has:gen_ai.system",
    "fields": ["gen_ai.system", "gen_ai.request.model", "count()"],
    "sort": "-count()"
  }
- "slowest AI/LLM calls" → 
  {
    "query": "has:gen_ai.request.model",
    "fields": ["gen_ai.system", "gen_ai.request.model", "span.duration", "transaction", "timestamp", "project", "trace", "gen_ai.operation.name"],
    "sort": "-span.duration"
  }
- "agent calls by model usage" → 
  {
    "query": "has:gen_ai.request.model",
    "fields": ["gen_ai.request.model", "count()"],
    "sort": "-count()"
  }
- "average agent call duration by model" → 
  {
    "query": "has:gen_ai.request.model",
    "fields": ["gen_ai.request.model", "count()", "avg(span.duration)", "p95(span.duration)"],
    "sort": "-avg(span.duration)"
  }
- "token usage by AI system" → 
  {
    "query": "has:gen_ai.usage.input_tokens",
    "fields": ["gen_ai.system", "sum(gen_ai.usage.input_tokens)", "sum(gen_ai.usage.output_tokens)", "count()"],
    "sort": "-sum(gen_ai.usage.input_tokens)"
  }
- "how many tokens used today" → 
  {
    "query": "has:gen_ai.usage.input_tokens",
    "fields": ["sum(gen_ai.usage.input_tokens)", "sum(gen_ai.usage.output_tokens)", "count()"],
    "sort": "-sum(gen_ai.usage.input_tokens)",
    "timeRange": {"statsPeriod": "24h"}
  }
- "average response time in milliseconds" → 
  {
    "query": "is_transaction:true",
    "fields": ["transaction", "equation|avg(span.duration) * 1000"],
    "sort": "-equation|avg(span.duration) * 1000",
    "timeRange": {"statsPeriod": "24h"}
  }
- "total input tokens by model" → 
  {
    "query": "has:gen_ai.usage.input_tokens",
    "fields": ["gen_ai.request.model", "sum(gen_ai.usage.input_tokens)", "count()"],
    "sort": "-sum(gen_ai.usage.input_tokens)"
  }
- "tokens used this week" → 
  {
    "query": "has:gen_ai.usage.input_tokens",
    "fields": ["sum(gen_ai.usage.input_tokens)", "sum(gen_ai.usage.output_tokens)", "count()"],
    "sort": "-sum(gen_ai.usage.input_tokens)",
    "timeRange": {"statsPeriod": "7d"}
  }
- "which user agents have the most tool calls yesterday" → 
  {
    "query": "has:mcp.tool.name AND has:user_agent.original",
    "fields": ["user_agent.original", "count()"],
    "sort": "-count()",
    "timeRange": {"statsPeriod": "24h"}
  }
- "top 10 browsers by API calls" → 
  {
    "query": "has:http.method AND has:user_agent.original",
    "fields": ["user_agent.original", "count()"],
    "sort": "-count()"
  }
- "most common clients making database queries" → 
  {
    "query": "has:db.statement AND has:user_agent.original",
    "fields": ["user_agent.original", "count()", "avg(span.duration)"],
    "sort": "-count()"
  }`,
  },
};

// Define recommended fields for each dataset
export const RECOMMENDED_FIELDS = {
  errors: {
    basic: [
      "issue",
      "title",
      "project",
      "timestamp",
      "level",
      "message",
      "error.type",
      "culprit",
    ],
    description:
      "Basic error information including issue ID, title, timestamp, severity, and location",
  },
  logs: {
    basic: ["timestamp", "project", "message", "severity", "trace"],
    description: "Essential log entry information",
  },
  spans: {
    basic: [
      "id",
      "span.op",
      "span.description",
      "span.duration",
      "transaction",
      "timestamp",
      "project",
      "trace",
    ],
    description:
      "Core span/trace information including span ID, operation, duration, and trace context",
  },
};
