import type { SentryApiService } from "../../../api-client";
import { logError } from "../../../logging";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Zod schemas for type-safe JSON parsing
const AttributeSchema = z.object({
  description: z.string(),
  type: z.string(),
  examples: z
    .array(z.any())
    .transform((arr) =>
      arr.map((v) => (Array.isArray(v) ? JSON.stringify(v) : v.toString())),
    )
    .optional(),
  note: z.string().optional(),
  stability: z.string().optional(),
});

const NamespaceDataSchema = z.object({
  namespace: z.string(),
  description: z.string(),
  attributes: z.record(z.string(), AttributeSchema),
  custom: z.boolean().optional(),
});

const NamespacesIndexSchema = z.object({
  generated: z.string(),
  totalNamespaces: z.number(),
  namespaces: z.array(
    z.object({
      namespace: z.string(),
      description: z.string(),
      custom: z.boolean().optional(),
    }),
  ),
});

// TypeScript types inferred from Zod schemas
type NamespaceData = z.infer<typeof NamespaceDataSchema>;
type NamespacesIndex = z.infer<typeof NamespacesIndexSchema>;

// Load all namespace data from JSON files
function loadNamespaceData(): Record<string, NamespaceData> {
  const dataDir = resolve(__dirname, "data");
  const namespaceData: Record<string, NamespaceData> = {};

  try {
    const files = readdirSync(dataDir).filter(
      (f) => f.endsWith(".json") && f !== "__namespaces.json",
    );

    for (const file of files) {
      const filePath = resolve(dataDir, file);
      try {
        const content = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(content);
        const validated = NamespaceDataSchema.parse(parsed);
        namespaceData[validated.namespace] = validated;
      } catch (error) {
        console.warn(`Failed to load namespace file ${file}:`, error);
      }
    }
  } catch (error) {
    logError(error as Error, { context: { operation: "loadNamespaceData" } });
  }

  return namespaceData;
}

// Cache the namespace data to avoid re-reading files
const NAMESPACE_DATA = loadNamespaceData();

// Load the namespaces index
export function loadNamespacesIndex(): NamespacesIndex {
  const indexPath = resolve(__dirname, "data", "__namespaces.json");
  try {
    const content = readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(content);
    return NamespacesIndexSchema.parse(parsed);
  } catch (error) {
    logError(error as Error, { context: { operation: "loadNamespacesIndex" } });
    // Return empty index if file doesn't exist or validation fails
    return {
      generated: new Date().toISOString(),
      totalNamespaces: 0,
      namespaces: [],
    };
  }
}

// Map common query terms to OpenTelemetry semantic conventions
const SEMANTIC_MAPPINGS: Record<string, string> = {
  agent: "gen_ai",
  ai: "gen_ai",
  llm: "gen_ai",
  model: "gen_ai",
  anthropic: "gen_ai",
  openai: "gen_ai",
  claude: "gen_ai",
  database: "db",
  db: "db",
  sql: "db",
  query: "db",
  postgresql: "db",
  mysql: "db",
  redis: "db",
  mongodb: "db",
  http: "http",
  api: "http",
  request: "http",
  response: "http",
  get: "http",
  post: "http",
  tool: "mcp",
  "tool calls": "mcp",
  "tool call": "mcp",
  mcp: "mcp",
  rpc: "rpc",
  grpc: "rpc",
  messaging: "messaging",
  queue: "messaging",
  kafka: "messaging",
  rabbitmq: "messaging",
  k8s: "k8s",
  kubernetes: "k8s",
  container: "container",
  docker: "container",
  pod: "k8s",
  cloud: "cloud",
  aws: "aws",
  azure: "azure",
  gcp: "gcp",
  network: "network",
  tcp: "network",
  udp: "network",
};

/**
 * Look up all attributes for a specific OpenTelemetry namespace
 */
export async function lookupOtelSemantics(
  namespace: string,
  searchTerm: string | undefined,
  dataset: "errors" | "logs" | "spans",
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
): Promise<string> {
  try {
    // Get namespace data
    const namespaceData = NAMESPACE_DATA[namespace];
    if (!namespaceData) {
      return `Namespace '${namespace}' not found. Available namespaces: ${Object.keys(NAMESPACE_DATA).slice(0, 10).join(", ")}...`;
    }

    // Format attribute information
    const attributes = Object.entries(namespaceData.attributes);
    const attributeInfo = attributes
      .slice(0, 20) // Limit to first 20 attributes
      .map(([name, info]) => {
        let desc = `${name}: ${info.description}`;
        if (info.type !== "string") {
          desc += ` (${info.type})`;
        }
        if (info.examples && info.examples.length > 0) {
          desc += ` - examples: ${info.examples.slice(0, 3).join(", ")}`;
        }
        return desc;
      })
      .join("\n");

    const hasPattern = `has:${namespace}.*`;
    const totalAttrs = attributes.length;

    return `Namespace: ${namespace}
Description: ${namespaceData.description}
Total attributes: ${totalAttrs}
Query pattern: ${hasPattern}

Common attributes:
${attributeInfo}

${totalAttrs > 20 ? `... and ${totalAttrs - 20} more attributes` : ""}`;
  } catch (error) {
    return `Error looking up namespace '${namespace}'. Use standard OpenTelemetry conventions.`;
  }
}

/**
 * Get detailed information about a specific namespace
 */
export function getNamespaceInfo(namespace: string): NamespaceData | undefined {
  return NAMESPACE_DATA[namespace];
}

/**
 * Get all available namespaces
 */
export function getAvailableNamespaces(): string[] {
  return Object.keys(NAMESPACE_DATA);
}
