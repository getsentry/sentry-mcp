/**
 * sentry schema
 *
 * Browse and search the Sentry API schema. Shows available resources,
 * operations, and endpoint details from the generated API index.
 *
 * Usage:
 *   sentry schema                      → list all resources
 *   sentry schema --all                → flat list of all endpoints
 *   sentry schema --search <query>     → search endpoints by keyword
 *   sentry schema <resource>           → show endpoints for a resource
 *   sentry schema <resource> <op>      → show detailed endpoint info
 *   sentry schema monitor*             → glob search for resources
 */

import type { SentryContext } from "../context.js";
import {
  type ApiEndpoint,
  getAllEndpoints,
  getEndpoint,
  getEndpointsByResource,
  getResourceSummaries,
  type ResourceSummary,
  searchEndpoints,
} from "../lib/api-schema.js";
import { buildCommand } from "../lib/command.js";
import { OutputError, ResolutionError } from "../lib/errors.js";
import { bold, cyan, muted, yellow } from "../lib/formatters/colors.js";
import { filterFields } from "../lib/formatters/json.js";
import {
  colorTag,
  mdKvTable,
  renderMarkdown,
} from "../lib/formatters/markdown.js";
import { CommandOutput } from "../lib/formatters/output.js";
import { fuzzyMatch } from "../lib/fuzzy.js";

// ---------------------------------------------------------------------------
// Output data types
// ---------------------------------------------------------------------------

/** Discriminated union of all possible schema command outputs */
type SchemaResult =
  | { kind: "resources"; resources: ResourceSummary[] }
  | { kind: "endpoints"; endpoints: readonly ApiEndpoint[] }
  | { kind: "endpoint"; endpoint: ApiEndpoint };

// ---------------------------------------------------------------------------
// Human formatters
// ---------------------------------------------------------------------------

/** Format a method string with appropriate coloring */
function formatMethod(method: string): string {
  switch (method) {
    case "GET":
      return cyan(method);
    case "POST":
      return bold(method);
    case "PUT":
      return yellow(method);
    case "DELETE":
      return bold(method);
    default:
      return method;
  }
}

/** Format the resource summary table (default view) */
function formatResourceList(resources: ResourceSummary[]): string {
  if (resources.length === 0) {
    return muted("No resources found.");
  }

  const maxName = Math.max(...resources.map((r) => r.name.length));
  const maxCount = Math.max(
    ...resources.map((r) => String(r.endpointCount).length)
  );
  const padding = 4;

  const header = `${bold("RESOURCE".padEnd(maxName + padding))}${bold("COUNT".padEnd(maxCount + padding))}${bold("METHODS")}`;

  const rows = resources.map((r) => {
    const name = cyan(r.name.padEnd(maxName + padding));
    const count = String(r.endpointCount).padEnd(maxCount + padding);
    const methods = muted(r.methods.join(", "));
    return `${name}${count}${methods}`;
  });

  return [header, ...rows].join("\n");
}

/** Format a flat list of endpoints */
function formatEndpointList(endpoints: readonly ApiEndpoint[]): string {
  if (endpoints.length === 0) {
    return muted("No endpoints found.");
  }

  const maxMethod = Math.max(...endpoints.map((e) => e.method.length));
  const padding = 2;

  return endpoints
    .map((e) => {
      const colored = formatMethod(e.method);
      const padded = `${colored}${" ".repeat(maxMethod + padding - e.method.length)}`;
      const path = e.path;
      const label = muted(e.operationId || e.fn);
      const deprecated = e.deprecated ? yellow(" [deprecated]") : "";
      return `${padded}${path}  ${label}${deprecated}`;
    })
    .join("\n");
}

/** Format a single endpoint in detail using mdKvTable + renderMarkdown */
function formatEndpointDetail(endpoint: ApiEndpoint): string {
  const kvRows: [string, string][] = [
    ["Resource", endpoint.resource],
    ["Operation", endpoint.operationId],
    ...(endpoint.fn
      ? [["Function", `\`${endpoint.fn}\``] as [string, string]]
      : []),
  ];

  if (endpoint.deprecated) {
    kvRows.push(["Status", colorTag("yellow", "deprecated")]);
  }

  if (endpoint.pathParams.length > 0) {
    kvRows.push(["Path Params", endpoint.pathParams.join(", ")]);
  }

  if (endpoint.queryParams.length > 0) {
    kvRows.push(["Query Params", endpoint.queryParams.join(", ")]);
  }

  const heading = `## ${endpoint.method} \`${endpoint.path}\``;
  const parts = [heading, "", mdKvTable(kvRows)];

  if (endpoint.description) {
    parts.push("", endpoint.description);
  }

  return renderMarkdown(parts.join("\n"));
}

/** Human renderer for all schema result variants */
function formatSchemaHuman(data: SchemaResult): string {
  switch (data.kind) {
    case "resources":
      return formatResourceList(data.resources);
    case "endpoints":
      return formatEndpointList(data.endpoints);
    case "endpoint":
      return formatEndpointDetail(data.endpoint);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// JSON transform — strip the internal `kind` discriminant
// ---------------------------------------------------------------------------

/**
 * Transform schema output for JSON serialization.
 * Strips the internal `kind` discriminant and applies `--fields` filtering.
 */
function jsonTransformSchema(data: SchemaResult, fields?: string[]): unknown {
  let result: unknown;
  switch (data.kind) {
    case "resources":
      result = data.resources;
      break;
    case "endpoints":
      result = data.endpoints;
      break;
    case "endpoint":
      result = data.endpoint;
      break;
    default:
      result = data;
  }
  if (fields && fields.length > 0) {
    return filterFields(result, fields);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Query resolution
// ---------------------------------------------------------------------------

/**
 * Build the "no resource matches" error for a term that matched nothing.
 *
 * Previously these paths dumped the full resource list via `OutputError`,
 * which rendered byte-identical to a successful `sentry schema` browse and
 * gave no signal that the term matched nothing. A {@link ResolutionError}
 * reports the failure plainly, adds "did you mean" suggestions from a fuzzy
 * match, and exits non-zero so scripts can branch on it.
 */
function noResourceMatchError(resource: string): ResolutionError {
  const names = getResourceSummaries().map((r) => r.name);
  const [closest] = fuzzyMatch(resource, names, { maxResults: 1 });
  const browseHint = "sentry schema";
  const searchHint = `sentry schema --search ${resource}    Search endpoints by keyword`;
  // Lead with the closest resource name when a typo has an obvious fix
  // (e.g. "committers" → "commits"); otherwise point at the full browse.
  const primaryHint = closest ? `sentry schema ${closest}` : browseHint;
  const suggestions = closest
    ? ["sentry schema                    Browse all resources", searchHint]
    : [searchHint];
  return new ResolutionError(
    `Resource "${resource}"`,
    "does not exist in the schema",
    primaryHint,
    suggestions
  );
}

/**
 * Resolve a resource + optional operation into a SchemaResult.
 * Throws ResolutionError for no-match cases; throws OutputError with the
 * resource's endpoints when the resource exists but the operation does not.
 */
export function resolveResourceQuery(
  resource: string,
  operation?: string
): SchemaResult {
  // Glob-style search: if the resource arg contains * or ?, match resources
  if (resource.includes("*") || resource.includes("?")) {
    // Convert glob pattern to regex: * → .*, ? → ., escape other special chars
    const escaped = resource
      .toLowerCase()
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    const pattern = new RegExp(`^${escaped}$`);
    const allResources = getResourceSummaries();
    const matched = allResources.filter((r) =>
      pattern.test(r.name.toLowerCase())
    );
    if (matched.length === 0) {
      throw new ResolutionError(
        `Pattern "${resource}"`,
        "matched no resources",
        "sentry schema",
        ["sentry schema --all    List every endpoint in a flat table"]
      );
    }
    const endpoints = matched.flatMap((r) => getEndpointsByResource(r.name));
    return { kind: "endpoints", endpoints };
  }

  // Resource + operation: show single endpoint detail
  if (operation) {
    const endpoint = getEndpoint(resource, operation);
    if (endpoint) {
      return { kind: "endpoint", endpoint };
    }
    // Resource exists but the operation didn't match: show its endpoints so
    // the user can pick a valid operation. This is scoped to the resource,
    // not the full list, so it isn't misleading.
    const resourceEndpoints = getEndpointsByResource(resource);
    if (resourceEndpoints.length > 0) {
      throw new OutputError({
        kind: "endpoints",
        endpoints: resourceEndpoints,
      } satisfies SchemaResult);
    }
    throw noResourceMatchError(resource);
  }

  // Resource only: show all endpoints for that resource
  const endpoints = getEndpointsByResource(resource);
  if (endpoints.length === 0) {
    throw noResourceMatchError(resource);
  }
  return { kind: "endpoints", endpoints };
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

type SchemaFlags = {
  readonly all: boolean;
  readonly search?: string;
};

export const schemaCommand = buildCommand({
  auth: false,
  docs: {
    brief: "Browse the Sentry API schema",
    fullDescription:
      "Browse and search the Sentry API schema. Shows available resources, " +
      "operations, and endpoint details. Use with --json for machine-readable output.\n\n" +
      "Examples:\n" +
      "  sentry schema                      List all API resources\n" +
      "  sentry schema issues                Show endpoints for a resource\n" +
      "  sentry schema issues list            Show details for one endpoint\n" +
      "  sentry schema --all                 Flat list of all endpoints\n" +
      "  sentry schema --search monitor      Search endpoints by keyword",
  },
  output: {
    human: formatSchemaHuman,
    jsonTransform: jsonTransformSchema,
  },
  parameters: {
    flags: {
      all: {
        kind: "boolean",
        brief: "Show all endpoints in a flat list",
        default: false,
      },
      search: {
        kind: "parsed",
        parse: String,
        brief: "Search endpoints by keyword",
        optional: true,
      },
    },
    aliases: { q: "search" },
    positional: {
      kind: "array",
      parameter: {
        brief: "Resource name and optional operation",
        parse: String,
        placeholder: "resource",
      },
    },
  },
  // biome-ignore lint/suspicious/useAwait: Stricli requires AsyncGenerator but schema queries are synchronous (in-memory JSON)
  async *func(this: SentryContext, flags: SchemaFlags, ...args: string[]) {
    const [resource, operation] = args;

    // --search takes priority
    if (flags.search) {
      const results = searchEndpoints(flags.search);
      if (results.length === 0) {
        throw new OutputError({
          kind: "endpoints",
          endpoints: [],
        } satisfies SchemaResult);
      }
      return yield new CommandOutput<SchemaResult>({
        kind: "endpoints",
        endpoints: results,
      });
    }

    // --all: flat endpoint list
    if (flags.all) {
      return yield new CommandOutput<SchemaResult>({
        kind: "endpoints",
        endpoints: getAllEndpoints(),
      });
    }

    // No positional args: show resource summary
    if (!resource) {
      const resources = getResourceSummaries();
      return yield new CommandOutput<SchemaResult>({
        kind: "resources",
        resources,
      });
    }

    // Resolve resource (with optional operation or glob pattern)
    return yield new CommandOutput(resolveResourceQuery(resource, operation));
  },
});
