/**
 * Mock Data Generator for Sentry Events
 *
 * This module provides realistic mock data generation for errors, logs, and spans
 * based on query parameters. It supports time-based filtering, query parsing,
 * and contextual response generation.
 */

import { parseISO, subHours, subDays, format } from "date-fns";

// Types for our mock data
interface MockError {
  "issue.id": number;
  issue: string;
  title: string;
  project: string;
  "count()": number;
  "last_seen()": string;
  level?: string;
  "error.type"?: string;
  "error.handled"?: boolean;
  "user.email"?: string;
  environment?: string;
}

interface MockLog {
  timestamp: string;
  project: string;
  message: string;
  severity: string;
  trace?: string;
  "sentry.item_id": string;
  environment?: string;
  "user.email"?: string;
}

interface MockSpan {
  id: string;
  "span.op": string;
  "span.description": string;
  "span.duration": number;
  transaction: string;
  timestamp: string;
  is_transaction: boolean;
  project: string;
  trace: string;
  "transaction.span_id"?: string;
  "span.status"?: string;
  environment?: string;
}

// Base mock data templates
const ERROR_TEMPLATES: Partial<MockError>[] = [
  {
    title: "DatabaseError: Connection timeout",
    "error.type": "DatabaseError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "NullPointerException: Cannot read property 'id' of null",
    "error.type": "NullPointerException",
    "error.handled": false,
    level: "error",
  },
  {
    title: "AuthenticationError: Invalid credentials",
    "error.type": "AuthenticationError",
    "error.handled": true,
    level: "error",
  },
  {
    title: "HTTPError: 500 Internal Server Error",
    "error.type": "HTTPError",
    "error.handled": true,
    level: "error",
  },
  {
    title: "TimeoutError: Request timed out after 30s",
    "error.type": "TimeoutError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "ValidationError: Missing required field 'email'",
    "error.type": "ValidationError",
    "error.handled": true,
    level: "warning",
  },
  {
    title: "MemoryError: JavaScript heap out of memory",
    "error.type": "MemoryError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "TypeError: Cannot read properties of undefined",
    "error.type": "TypeError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "Login failed with 401 unauthorized",
    "error.type": "UnauthorizedError",
    "error.handled": true,
    level: "error",
  },
  {
    title: "Server error 500 - Internal server error",
    "error.type": "ServerError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "JavaScript error in production",
    "error.type": "JavaScriptError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "Authentication error - invalid credentials",
    "error.type": "AuthError",
    "error.handled": true,
    level: "error",
  },
  {
    title: "Database connection error - connection refused",
    "error.type": "DatabaseConnectionError",
    "error.handled": false,
    level: "error",
  },
  {
    title: "Timeout error in checkout API",
    "error.type": "TimeoutError",
    "error.handled": false,
    level: "error",
  },
];

const LOG_TEMPLATES: Partial<MockLog>[] = [
  {
    message: "Database connection established successfully",
    severity: "info",
  },
  {
    message: "ERROR: Failed to connect to Redis cache",
    severity: "error",
  },
  {
    message: "WARNING: Memory usage above 80%",
    severity: "warning",
  },
  {
    message: "User authentication failed for email: user@example.com",
    severity: "error",
  },
  {
    message: "API request completed in 234ms",
    severity: "info",
  },
  {
    message: "DEBUG: Processing payment for order #12345",
    severity: "debug",
  },
  {
    message: "CRITICAL: Database connection pool exhausted",
    severity: "fatal",
  },
  {
    message: "Cache miss for key: user_preferences_123",
    severity: "debug",
  },
];

const SPAN_TEMPLATES: Partial<MockSpan>[] = [
  {
    "span.op": "db.query",
    "span.description": "SELECT * FROM users WHERE id = ?",
    "span.duration": 45.2,
    transaction: "GET /api/users/:id",
  },
  {
    "span.op": "http.client",
    "span.description": "GET https://api.external.com/data",
    "span.duration": 234.5,
    transaction: "POST /api/checkout",
  },
  {
    "span.op": "cache.get",
    "span.description": "GET user:preferences:123",
    "span.duration": 2.3,
    transaction: "GET /api/preferences",
  },
  {
    "span.op": "db.query",
    "span.description": "INSERT INTO orders ...",
    "span.duration": 156.7,
    transaction: "POST /api/orders",
  },
  {
    "span.op": "http.server",
    "span.description": "POST /api/checkout",
    "span.duration": 543.2,
    is_transaction: true,
  },
  {
    "span.op": "cache.set",
    "span.description": "SET session:abc123",
    "span.duration": 1.2,
    transaction: "POST /api/login",
  },
  // Add more templates for better coverage
  {
    "span.op": "db.query",
    "span.description": "SELECT * FROM users - timeout after 5001ms",
    "span.duration": 5001.0,
    transaction: "GET /api/slow-query",
  },
  {
    "span.op": "http.client",
    "span.description": "POST /api/external - timeout",
    "span.duration": 30000.0,
    transaction: "POST /api/timeout",
  },
  {
    "span.op": "db",
    "span.description": "Database connection timeout",
    "span.duration": 10000.0,
    transaction: "GET /api/db-timeout",
  },
  {
    "span.op": "http.server",
    "span.description": "GET /api/slow-endpoint",
    "span.duration": 6500.0,
    is_transaction: true,
  },
  {
    "span.op": "cache.get",
    "span.description": "Redis timeout - connection failed",
    "span.duration": 5000.0,
    transaction: "GET /api/cache-timeout",
  },
];

// Utility functions
function generateId(prefix = ""): string {
  return prefix + Math.random().toString(36).substring(2, 15);
}

function generateTimestamp(hoursAgo = 0): string {
  const date = subHours(new Date(), hoursAgo);
  return format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function parseTimeFilter(query: string): { start?: Date; end?: Date } {
  const now = new Date();

  // Parse relative time filters like timestamp:-1h or timestamp:-24h
  const relativeMatch = query.match(/timestamp:(-\d+[hdm])/);
  if (relativeMatch) {
    const [, duration] = relativeMatch;
    const value = Number.parseInt(duration.slice(1, -1));
    const unit = duration.slice(-1);

    switch (unit) {
      case "h":
        return { start: subHours(now, value), end: now };
      case "d":
        return { start: subDays(now, value), end: now };
      case "m":
        return { start: subHours(now, value / 60), end: now };
    }
  }

  // Default to last 24 hours
  return { start: subDays(now, 1), end: now };
}

// Query parser
export interface QueryContext {
  dataset: "errors" | "logs" | "spans";
  query: string;
  timeRange: { start?: Date; end?: Date };
  filters: {
    level?: string;
    severity?: string;
    errorType?: string;
    handled?: boolean;
    user?: string;
    project?: string;
    environment?: string;
    spanOp?: string;
    minDuration?: number;
    searchTerms?: string[];
  };
}

export function parseQuery(query: string, dataset: string): QueryContext {
  const context: QueryContext = {
    dataset: dataset as any,
    query,
    timeRange: parseTimeFilter(query),
    filters: {},
  };

  // Parse level/severity
  const levelMatch = query.match(/level:(\w+)/);
  if (levelMatch) context.filters.level = levelMatch[1];

  const severityMatch = query.match(/severity:(\w+)/);
  if (severityMatch) context.filters.severity = severityMatch[1];

  // Parse error type
  const errorTypeMatch = query.match(/error\.type:"?([^"\s]+)"?/);
  if (errorTypeMatch) context.filters.errorType = errorTypeMatch[1];

  // Parse handled status
  if (query.includes("error.handled:false")) context.filters.handled = false;
  if (query.includes("error.handled:true")) context.filters.handled = true;

  // Parse user email
  const userMatch = query.match(/user\.email:([^\s]+)/);
  if (userMatch) context.filters.user = userMatch[1];

  // Parse project
  const projectMatch = query.match(/project:([^\s]+)/);
  if (projectMatch) context.filters.project = projectMatch[1];

  // Parse environment
  const envMatch = query.match(/environment:(\w+)/);
  if (envMatch) context.filters.environment = envMatch[1];

  // Parse span operation - handle wildcards
  const spanOpMatch = query.match(/span\.op:([^\s]+)/);
  if (spanOpMatch) {
    context.filters.spanOp = spanOpMatch[1].replace(/\*/g, "");
  }

  // Parse duration filters
  const durationMatch = query.match(/span\.duration:>(\d+)/);
  if (durationMatch)
    context.filters.minDuration = Number.parseInt(durationMatch[1]);

  // Extract general search terms - handle quoted strings
  let cleanQuery = query;
  const quotedStrings: string[] = [];
  const quotedMatches = query.match(/"[^"]+"/g);
  if (quotedMatches) {
    quotedMatches.forEach((match, index) => {
      const placeholder = `__QUOTED_${index}__`;
      quotedStrings.push(match.slice(1, -1)); // Remove quotes
      cleanQuery = cleanQuery.replace(match, placeholder);
    });
  }

  const searchTerms = cleanQuery
    .replace(/\w+\.\w+:\S+/g, "") // Remove field.subfield:value pairs
    .replace(/\w+:\S+/g, "") // Remove field:value pairs
    .replace(/AND|OR|NOT/g, "") // Remove boolean operators
    .replace(/[()]/g, "") // Remove parentheses
    .replace(/__QUOTED_\d+__/g, "") // Remove quoted placeholders
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .concat(quotedStrings); // Add back quoted strings

  if (searchTerms.length > 0) {
    context.filters.searchTerms = searchTerms;
  }

  // Special case: match patterns in original query
  if (query.includes("401") || query.includes("login")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "login",
      "401",
    ];
  }
  if (query.includes("5xx") || query.includes("500")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "server",
      "500",
      "5xx",
    ];
  }
  if (query.includes("authentication")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "authentication",
      "auth",
    ];
  }
  if (query.includes("javascript")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "javascript",
      "js",
    ];
  }
  if (query.includes("database") && query.includes("connection")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "database",
      "connection",
    ];
  }
  if (query.includes("timeout")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "timeout",
    ];
  }
  if (query.includes("checkout")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "checkout",
    ];
  }
  if (query.includes("redis") || query.includes("cache")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "redis",
      "cache",
    ];
  }
  if (query.includes("memory")) {
    context.filters.searchTerms = [
      ...(context.filters.searchTerms || []),
      "memory",
    ];
  }

  return context;
}

// Data generators
export function generateErrors(context: QueryContext, count = 10): MockError[] {
  const errors: MockError[] = [];
  const { filters, timeRange } = context;
  let attempts = 0;
  const maxAttempts = count * 20; // Try up to 20x to find matching items

  while (errors.length < count && attempts < maxAttempts) {
    const template = ERROR_TEMPLATES[attempts % ERROR_TEMPLATES.length];
    const hoursAgo = Math.random() * 24; // Random time within last 24 hours

    const error: MockError = {
      "issue.id": 6000000000 + Math.floor(Math.random() * 1000000),
      issue: `CLOUDFLARE-MCP-${41 + attempts}`,
      title: template.title || "Generic Error",
      project: filters.project || "cloudflare-mcp",
      "count()": Math.floor(Math.random() * 100) + 1,
      "last_seen()": generateTimestamp(hoursAgo),
      level: template.level || "error",
      "error.type": template["error.type"],
      "error.handled": template["error.handled"],
      environment: filters.environment || "production",
    };

    // Apply filters
    let passesFilters = true;

    if (filters.level && error.level !== filters.level) passesFilters = false;
    if (filters.errorType && error["error.type"] !== filters.errorType)
      passesFilters = false;
    if (
      filters.handled !== undefined &&
      error["error.handled"] !== filters.handled
    )
      passesFilters = false;

    // Check search terms
    if (filters.searchTerms && passesFilters) {
      const errorText =
        `${error.title} ${error["error.type"] || ""} ${error.level || ""}`.toLowerCase();
      const matchesSearch = filters.searchTerms.some((term) =>
        errorText.includes(term.toLowerCase()),
      );
      if (!matchesSearch) passesFilters = false;
    }

    if (passesFilters) {
      if (filters.user) error["user.email"] = filters.user;
      errors.push(error);
    }

    attempts++;
  }

  return errors;
}

export function generateLogs(context: QueryContext, count = 10): MockLog[] {
  const logs: MockLog[] = [];
  const { filters, timeRange } = context;
  let attempts = 0;
  const maxAttempts = count * 20;

  while (logs.length < count && attempts < maxAttempts) {
    const template = LOG_TEMPLATES[attempts % LOG_TEMPLATES.length];
    const hoursAgo = Math.random() * 24;

    const log: MockLog = {
      timestamp: generateTimestamp(hoursAgo),
      project: filters.project || "cloudflare-mcp",
      message: template.message || "Log message",
      severity: template.severity || "info",
      trace: generateId(),
      "sentry.item_id": generateId(),
      environment: filters.environment || "production",
    };

    // Apply filters
    let passesFilters = true;

    if (filters.severity && log.severity !== filters.severity)
      passesFilters = false;

    // Check search terms
    if (filters.searchTerms && passesFilters) {
      const matchesSearch = filters.searchTerms.some((term) =>
        log.message.toLowerCase().includes(term.toLowerCase()),
      );
      if (!matchesSearch) passesFilters = false;
    }

    if (passesFilters) {
      if (filters.user) log["user.email"] = filters.user;
      logs.push(log);
    }

    attempts++;
  }

  return logs;
}

export function generateSpans(context: QueryContext, count = 10): MockSpan[] {
  const spans: MockSpan[] = [];
  const { filters, timeRange } = context;
  let attempts = 0;
  const maxAttempts = count * 20;

  while (spans.length < count && attempts < maxAttempts) {
    const template = SPAN_TEMPLATES[attempts % SPAN_TEMPLATES.length];
    const hoursAgo = Math.random() * 24;

    const span: MockSpan = {
      id: generateId(),
      "span.op": template["span.op"] || "http.server",
      "span.description": template["span.description"] || "Generic operation",
      "span.duration": template["span.duration"] || Math.random() * 1000,
      transaction: template.transaction || "GET /api/endpoint",
      timestamp: generateTimestamp(hoursAgo),
      is_transaction: template.is_transaction || false,
      project: filters.project || "cloudflare-mcp",
      trace: generateId(),
      "span.status": "ok",
      environment: filters.environment || "production",
    };

    if (span.is_transaction) {
      span["transaction.span_id"] = span.id;
    }

    // Apply filters
    let passesFilters = true;

    if (filters.spanOp && !span["span.op"].includes(filters.spanOp))
      passesFilters = false;
    if (filters.minDuration && span["span.duration"] < filters.minDuration)
      passesFilters = false;

    // Check search terms
    if (filters.searchTerms && passesFilters) {
      const matchesSearch = filters.searchTerms.some(
        (term) =>
          span["span.description"].toLowerCase().includes(term.toLowerCase()) ||
          span.transaction.toLowerCase().includes(term.toLowerCase()),
      );
      if (!matchesSearch) passesFilters = false;
    }

    if (passesFilters) {
      spans.push(span);
    }

    attempts++;
  }

  return spans;
}

// Main response generator
export function generateMockResponse(
  dataset: string,
  query: string,
  fields: string[],
): any {
  const context = parseQuery(query || "", dataset);

  // Determine result count based on query specificity
  let resultCount = 10;
  if (Object.keys(context.filters).length > 2) {
    resultCount = Math.floor(Math.random() * 5) + 1; // 1-5 results for specific queries
  } else if (Object.keys(context.filters).length > 0) {
    resultCount = Math.floor(Math.random() * 10) + 5; // 5-15 results for general queries
  }

  switch (dataset) {
    case "errors": {
      const errors = generateErrors(context, resultCount);
      const fieldsObj: Record<string, string> = {};
      const unitsObj: Record<string, null> = {};
      for (const field of fields) {
        fieldsObj[field] = "string";
        unitsObj[field] = null;
      }

      return {
        data: errors,
        meta: {
          fields: fieldsObj,
          units: unitsObj,
          isMetricsData: false,
          isMetricsExtractedData: false,
          tips: { query: null, columns: null },
          datasetReason: "unchanged",
          dataset: "errors",
        },
      };
    }

    case "logs":
    case "ourlogs": {
      const logs = generateLogs(context, resultCount);
      const fieldsObj: Record<string, string> = {};
      const unitsObj: Record<string, null> = {};
      for (const field of fields) {
        fieldsObj[field] = "string";
        unitsObj[field] = null;
      }

      return {
        data: logs,
        meta: {
          fields: fieldsObj,
          units: unitsObj,
          isMetricsData: false,
          isMetricsExtractedData: false,
          tips: { query: null, columns: null },
          datasetReason: "unchanged",
          dataset: "logs",
        },
      };
    }

    case "spans": {
      const spans = generateSpans(context, resultCount);
      const fieldsObj: Record<string, string> = {};
      const unitsObj: Record<string, string | null> = {};

      for (const field of fields) {
        fieldsObj[field] = field.includes("duration")
          ? "duration"
          : field.includes("is_transaction")
            ? "boolean"
            : "string";
        unitsObj[field] = field.includes("duration") ? "millisecond" : null;
      }

      return {
        data: spans,
        meta: {
          fields: fieldsObj,
          units: unitsObj,
          isMetricsData: false,
          isMetricsExtractedData: false,
          tips: {},
          datasetReason: "unchanged",
          dataset: "spans",
        },
      };
    }

    default:
      throw new Error(`Unknown dataset: ${dataset}`);
  }
}
