import type { SentryApiService } from "../../../api-client";
import { logError } from "../../../logging";
import { z } from "zod";

// Import the bundled data (will be generated at build time)
import { namespaceDataBundle, namespacesIndex } from "./data/otel-data-bundle";

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

// Cache for parsed data
let parsedNamespaceData: Record<string, NamespaceData> | null = null;
let parsedIndex: NamespacesIndex | null = null;

// Load all namespace data from bundled module
function loadNamespaceData(): Record<string, NamespaceData> {
  if (parsedNamespaceData) {
    return parsedNamespaceData;
  }

  const data: Record<string, NamespaceData> = {};

  for (const [key, value] of Object.entries(namespaceDataBundle)) {
    try {
      const parsed = NamespaceDataSchema.parse(value);
      data[key] = parsed;
    } catch (error) {
      logError({
        message: `Failed to parse namespace data for ${key}`,
        error,
      });
    }
  }

  parsedNamespaceData = data;
  return data;
}

// Load namespaces index
function loadNamespacesIndex(): NamespacesIndex | null {
  if (parsedIndex) {
    return parsedIndex;
  }

  try {
    parsedIndex = NamespacesIndexSchema.parse(namespacesIndex);
    return parsedIndex;
  } catch (error) {
    logError({
      message: "Failed to parse namespaces index",
      error,
    });
    return null;
  }
}

// Initialize data
const namespaceData = loadNamespaceData();
const index = loadNamespacesIndex();

// Create a namespace description lookup
const namespaceDescriptions = new Map<string, string>(
  index?.namespaces.map((ns) => [ns.namespace, ns.description]) || [],
);

/**
 * Lookup OpenTelemetry semantic convention attributes for a given namespace
 */
export async function lookupOtelSemantics(
  namespace: string,
  searchTerm: string | undefined,
  dataset: "errors" | "logs" | "spans",
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
): Promise<string> {
  // Normalize namespace (replace - with _)
  const normalizedNamespace = namespace.replace(/-/g, "_");

  // Check if namespace exists
  const data = namespaceData[normalizedNamespace];
  if (!data) {
    // Try to find similar namespaces
    const allNamespaces = Object.keys(namespaceData);
    const suggestions = allNamespaces
      .filter((ns) => ns.includes(namespace) || namespace.includes(ns))
      .slice(0, 3);

    return suggestions.length > 0
      ? `Namespace '${namespace}' not found. Did you mean: ${suggestions.join(", ")}?`
      : `Namespace '${namespace}' not found. Use 'list' to see all available namespaces.`;
  }

  // Format the response
  let response = `# OpenTelemetry Semantic Conventions: ${data.namespace}\n\n`;
  response += `${data.description}\n\n`;

  if (data.custom) {
    response +=
      "**Note:** This is a custom namespace, not part of standard OpenTelemetry conventions.\n\n";
  }

  // Filter attributes if searchTerm is provided
  let attributes = Object.entries(data.attributes);
  if (searchTerm) {
    const lowerSearch = searchTerm.toLowerCase();
    attributes = attributes.filter(
      ([key, attr]) =>
        key.toLowerCase().includes(lowerSearch) ||
        attr.description.toLowerCase().includes(lowerSearch),
    );
  }

  response += `## Attributes (${attributes.length} ${searchTerm ? "matching" : "total"})\n\n`;

  // Sort attributes by key
  const sortedAttributes = attributes.sort(([a], [b]) => a.localeCompare(b));

  for (const [key, attr] of sortedAttributes) {
    response += `### \`${key}\`\n`;
    response += `- **Type:** ${attr.type}\n`;
    response += `- **Description:** ${attr.description}\n`;

    if (attr.stability) {
      response += `- **Stability:** ${attr.stability}\n`;
    }

    if (attr.examples && attr.examples.length > 0) {
      response += `- **Examples:** ${attr.examples.map((ex) => `\`${ex}\``).join(", ")}\n`;
    }

    if (attr.note) {
      response += `- **Note:** ${attr.note}\n`;
    }

    response += "\n";
  }

  return response;
}
