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
    "mcp.tool.name": "Tool name (e.g., find_issues, search_events)",
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
