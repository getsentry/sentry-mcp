/**
 * sentry api
 *
 * Make raw authenticated API requests to Sentry.
 * Similar to 'gh api' for GitHub.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { rawApiRequest } from "../lib/api-client.js";
import type { Writer } from "../types/index.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type ApiFlags = {
  readonly method: HttpMethod;
  readonly field: string[];
  readonly header: string[];
  readonly include: boolean;
  readonly silent: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Request Parsing
// ─────────────────────────────────────────────────────────────────────────────

const VALID_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

/**
 * Parse HTTP method from string
 */
function parseMethod(value: string): HttpMethod {
  const upper = value.toUpperCase();
  if (!VALID_METHODS.includes(upper as HttpMethod)) {
    throw new Error(
      `Invalid method: ${value}. Must be one of: ${VALID_METHODS.join(", ")}`
    );
  }
  return upper as HttpMethod;
}

/**
 * Parse a single key=value field into nested object structure
 */
function parseFieldValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Set a nested value in an object using dot notation key
 */
function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  const keys = key.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k === undefined) {
      continue;
    }
    if (!(k in current)) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }

  const lastKey = keys.at(-1);
  if (lastKey) {
    current[lastKey] = value;
  }
}

/**
 * Parse field arguments into request body object
 */
function parseFields(fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid field format: ${field}. Expected key=value`);
    }

    const key = field.substring(0, eqIndex);
    const rawValue = field.substring(eqIndex + 1);
    const value = parseFieldValue(rawValue);

    setNestedValue(result, key, value);
  }

  return result;
}

/**
 * Parse header arguments into headers object
 */
function parseHeaders(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const header of headers) {
    const colonIndex = header.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Invalid header format: ${header}. Expected Key: Value`);
    }

    const key = header.substring(0, colonIndex).trim();
    const value = header.substring(colonIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write response headers to stdout
 */
function writeResponseHeaders(
  stdout: Writer,
  status: number,
  headers: Headers
): void {
  stdout.write(`HTTP ${status}\n`);
  headers.forEach((value, key) => {
    stdout.write(`${key}: ${value}\n`);
  });
  stdout.write("\n");
}

/**
 * Write response body to stdout
 */
function writeResponseBody(stdout: Writer, body: unknown): void {
  if (body === null || body === undefined) {
    return;
  }

  if (typeof body === "object") {
    stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  } else {
    stdout.write(`${String(body)}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Definition
// ─────────────────────────────────────────────────────────────────────────────

export const apiCommand = buildCommand({
  docs: {
    brief: "Make an authenticated API request",
    fullDescription:
      "Make a raw API request to the Sentry API. Similar to 'gh api' for GitHub. " +
      "The endpoint should start with '/api/0/' or be a full URL. " +
      "Authentication is handled automatically using your stored credentials.\n\n" +
      "Examples:\n" +
      "  sentry api /api/0/organizations/\n" +
      "  sentry api /api/0/issues/123/ --method PUT --field status=resolved\n" +
      "  sentry api /api/0/projects/my-org/my-project/issues/",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "API endpoint (e.g., /api/0/organizations/)",
          parse: String,
        },
      ],
    },
    flags: {
      method: {
        kind: "parsed",
        parse: parseMethod,
        brief: "HTTP method (GET, POST, PUT, DELETE, PATCH)",
        default: "GET" as const,
        placeholder: "METHOD",
      },
      field: {
        kind: "parsed",
        parse: String,
        brief: "Request body field (key=value). Can be repeated.",
        variadic: true,
      },
      header: {
        kind: "parsed",
        parse: String,
        brief: "Additional header (Key: Value). Can be repeated.",
        variadic: true,
      },
      include: {
        kind: "boolean",
        brief: "Include response headers in output",
        default: false,
      },
      silent: {
        kind: "boolean",
        brief: "Suppress output, only set exit code",
        default: false,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: ApiFlags,
    endpoint: string
  ): Promise<void> {
    const { stdout } = this;

    const body = flags.field?.length > 0 ? parseFields(flags.field) : undefined;
    const headers =
      flags.header?.length > 0 ? parseHeaders(flags.header) : undefined;

    const response = await rawApiRequest(endpoint, {
      method: flags.method,
      body,
      headers,
    });

    // Silent mode - only set exit code
    if (flags.silent) {
      if (response.status >= 400) {
        (this.process as NodeJS.Process).exitCode = 1;
      }
      return;
    }

    // Output headers if requested
    if (flags.include) {
      writeResponseHeaders(stdout, response.status, response.headers);
    }

    // Output body
    writeResponseBody(stdout, response.body);

    // Set exit code for error responses
    if (response.status >= 400) {
      (this.process as NodeJS.Process).exitCode = 1;
    }
  },
});
