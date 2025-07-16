#!/usr/bin/env tsx

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Zod schemas for type-safe YAML parsing
const OtelAttributeMemberSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.number()]),
  stability: z.string().optional(),
  brief: z.string().optional(),
  note: z.string().optional(),
});

// Type can be a string or an object with a 'members' property for enums
const OtelTypeSchema = z.union([
  z.string(),
  z.object({
    members: z.array(OtelAttributeMemberSchema),
  }),
]);

const OtelAttributeSchema = z.object({
  id: z.string(),
  type: OtelTypeSchema,
  stability: z.string().optional(),
  brief: z.string(),
  note: z.string().optional(),
  // Examples can be strings, numbers, booleans, or arrays (for array examples)
  examples: z
    .union([
      z.array(
        z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
      ),
      z.string(),
      z.number(),
      z.boolean(),
    ])
    .optional(),
  members: z.array(OtelAttributeMemberSchema).optional(),
});

const OtelGroupSchema = z.object({
  id: z.string(),
  type: z.string(),
  display_name: z.string().optional(),
  brief: z.string(),
  attributes: z.array(OtelAttributeSchema),
});

const OtelYamlFileSchema = z.object({
  groups: z.array(OtelGroupSchema),
});

// TypeScript types inferred from Zod schemas
type OtelAttribute = z.infer<typeof OtelAttributeSchema>;
type OtelGroup = z.infer<typeof OtelGroupSchema>;
type OtelYamlFile = z.infer<typeof OtelYamlFileSchema>;

interface JsonAttribute {
  description: string;
  type: string;
  examples?: string[];
  note?: string;
  stability?: string;
}

interface JsonNamespace {
  namespace: string;
  description: string;
  attributes: Record<string, JsonAttribute>;
}

// Known namespaces to process
const KNOWN_NAMESPACES = [
  "gen-ai",
  "database",
  "http",
  "rpc",
  "messaging",
  "faas",
  "k8s",
  "network",
  "server",
  "client",
  "cloud",
  "container",
  "host",
  "process",
  "service",
  "system",
  "user",
  "error",
  "exception",
  "url",
  "tls",
  "dns",
  "feature-flags",
  "code",
  "thread",
  "jvm",
  "nodejs",
  "dotnet",
  "go",
  "android",
  "ios",
  "browser",
  "aws",
  "azure",
  "gcp",
  "oci",
  "cloudevents",
  "graphql",
  "aspnetcore",
  "otel",
  "telemetry",
  "log",
  "profile",
  "test",
  "session",
  "deployment",
  "device",
  "disk",
  "hardware",
  "os",
  "vcs",
  "webengine",
  "signalr",
  "cicd",
  "artifact",
  "app",
  "file",
  "peer",
  "destination",
  "source",
  "cpython",
  "v8js",
  "mainframe",
  "zos",
  "linux",
  "enduser",
  "user_agent",
  "cpu",
  "cassandra",
  "elasticsearch",
  "heroku",
  "cloudfoundry",
  "opentracing",
  "geo",
  "security_rule",
];

const DATA_DIR = resolve(__dirname, "../src/tools/search-events/tools/data");
const CACHE_DIR = resolve(DATA_DIR, ".cache");
const GITHUB_BASE_URL =
  "https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/model";

// Ensure cache directory exists
function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

async function fetchYamlContent(namespace: string): Promise<string | null> {
  ensureCacheDir();

  const cacheFile = resolve(CACHE_DIR, `${namespace}.yaml`);

  // Check if we have a cached version
  if (existsSync(cacheFile)) {
    try {
      const cachedContent = readFileSync(cacheFile, "utf8");
      console.log(`📂 Using cached ${namespace}.yaml`);
      return cachedContent;
    } catch (error) {
      console.warn(
        `⚠️  Failed to read cached ${namespace}.yaml, fetching fresh copy`,
      );
    }
  }

  // Fetch from GitHub
  try {
    const response = await fetch(
      `${GITHUB_BASE_URL}/${namespace}/registry.yaml`,
    );
    if (!response.ok) {
      console.log(`⚠️  No registry.yaml found for namespace: ${namespace}`);
      return null;
    }

    const yamlContent = await response.text();

    // Cache the content
    try {
      writeFileSync(cacheFile, yamlContent);
      console.log(`💾 Cached ${namespace}.yaml`);
    } catch (error) {
      console.warn(`⚠️  Failed to cache ${namespace}.yaml:`, error);
    }

    return yamlContent;
  } catch (error) {
    console.error(`❌ Failed to fetch ${namespace}/registry.yaml:`, error);
    return null;
  }
}

function convertYamlToJson(
  yamlContent: string,
  namespace: string,
): JsonNamespace {
  // Parse YAML and validate with Zod
  const parsedYaml = parseYaml(yamlContent);
  const validationResult = OtelYamlFileSchema.safeParse(parsedYaml);

  if (!validationResult.success) {
    throw new Error(
      `Invalid YAML structure for ${namespace}: ${validationResult.error.message}`,
    );
  }

  const otelData = validationResult.data;

  if (otelData.groups.length === 0) {
    throw new Error(`No groups found in ${namespace}/registry.yaml`);
  }

  const group = otelData.groups[0]; // Take the first group
  const attributes: Record<string, JsonAttribute> = {};

  for (const attr of group.attributes) {
    // Extract the type string, handling both string and object types
    const typeStr = typeof attr.type === "string" ? attr.type : "string"; // enums are strings

    const jsonAttr: JsonAttribute = {
      description: attr.brief,
      type: inferType(typeStr),
    };

    if (attr.note) {
      jsonAttr.note = attr.note;
    }

    if (attr.stability) {
      jsonAttr.stability = attr.stability;
    }

    // Handle examples - normalize to string array
    if (attr.examples) {
      if (Array.isArray(attr.examples)) {
        jsonAttr.examples = attr.examples.map((ex) => {
          if (Array.isArray(ex)) {
            // For array examples, convert to JSON string
            return JSON.stringify(ex);
          }
          return String(ex);
        });
      } else {
        jsonAttr.examples = [String(attr.examples)];
      }
    }

    // Handle enums/members from the type object or explicit members
    if (typeof attr.type === "object" && attr.type.members) {
      jsonAttr.examples = attr.type.members.map((m) => String(m.value));
    } else if (attr.members) {
      jsonAttr.examples = attr.members.map((m) => String(m.value));
    }

    attributes[attr.id] = jsonAttr;
  }

  return {
    namespace: namespace.replace("-", "_"), // Convert hyphen to underscore for consistency
    description: group.brief,
    attributes,
  };
}

function inferType(otelType: string): string {
  // For semantic documentation, we keep the type mapping simple
  // The AI agent mainly needs to know if something is numeric (for aggregate functions)

  const cleanType = otelType.toLowerCase();

  if (
    cleanType.includes("int") ||
    cleanType.includes("double") ||
    cleanType.includes("number")
  ) {
    return "number";
  }
  if (cleanType.includes("bool")) {
    return "boolean";
  }
  return "string"; // Everything else is treated as string
}

async function generateNamespaceFiles() {
  console.log("🔄 Generating OpenTelemetry namespace files...");

  let processed = 0;
  let skipped = 0;
  const availableNamespaces: Array<{
    namespace: string;
    description: string;
    custom?: boolean;
  }> = [];

  for (const namespace of KNOWN_NAMESPACES) {
    const outputPath = resolve(DATA_DIR, `${namespace.replace("-", "_")}.json`);

    // Check if file exists and has custom content (not from OpenTelemetry)
    if (existsSync(outputPath)) {
      const existingContent = readFileSync(outputPath, "utf8");
      const existingJson = JSON.parse(existingContent);

      // Skip if this appears to be a custom namespace (not from OpenTelemetry)
      if (existingJson.namespace === "mcp" || existingJson.custom === true) {
        console.log(`⏭️  Skipping custom namespace: ${namespace}`);
        skipped++;
        continue;
      }
    }

    const yamlContent = await fetchYamlContent(namespace);
    if (!yamlContent) {
      console.log(`⏭️  Skipping ${namespace} (no registry.yaml found)`);
      skipped++;
      continue;
    }

    try {
      const jsonData = convertYamlToJson(yamlContent, namespace);
      writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));
      console.log(`✅ Generated: ${namespace.replace("-", "_")}.json`);
      processed++;

      // Add to available namespaces
      availableNamespaces.push({
        namespace: jsonData.namespace,
        description: jsonData.description,
      });
    } catch (error) {
      console.error(`❌ Failed to process ${namespace}:`, error);
      skipped++;
    }
  }

  console.log(`\n📊 Summary: ${processed} processed, ${skipped} skipped`);

  // Generate namespaces index
  generateNamespacesIndex(availableNamespaces);
}

// Generate index of all available namespaces
function generateNamespacesIndex(
  namespaces: Array<{
    namespace: string;
    description: string;
    custom?: boolean;
  }>,
) {
  // Add any existing custom namespaces that weren't in KNOWN_NAMESPACES
  const existingFiles = readdirSync(DATA_DIR).filter(
    (f) => f.endsWith(".json") && f !== "__namespaces.json",
  );

  for (const file of existingFiles) {
    const namespace = file.replace(".json", "");
    if (!namespaces.find((n) => n.namespace === namespace)) {
      try {
        const content = readFileSync(resolve(DATA_DIR, file), "utf8");
        const data = JSON.parse(content) as JsonNamespace & {
          custom?: boolean;
        };
        namespaces.push({
          namespace: data.namespace,
          description: data.description,
          custom: data.custom,
        });
      } catch (error) {
        console.warn(`⚠️  Failed to read ${file} for index`);
      }
    }
  }

  // Sort namespaces alphabetically
  namespaces.sort((a, b) => a.namespace.localeCompare(b.namespace));

  const indexPath = resolve(DATA_DIR, "__namespaces.json");
  const indexContent = {
    generated: new Date().toISOString(),
    totalNamespaces: namespaces.length,
    namespaces,
  };

  writeFileSync(indexPath, JSON.stringify(indexContent, null, 2));
  console.log(
    `📇 Generated namespace index: __namespaces.json (${namespaces.length} namespaces)`,
  );
}

// Add MCP namespace as a custom one
function generateMcpNamespace() {
  const mcpNamespace: JsonNamespace = {
    namespace: "mcp",
    description:
      "Model Context Protocol attributes for MCP tool calls and sessions",
    attributes: {
      "mcp.tool.name": {
        description: "Tool name (e.g., find_issues, search_events)",
        type: "string",
        examples: [
          "find_issues",
          "search_events",
          "get_issue_details",
          "update_issue",
        ],
      },
      "mcp.session.id": {
        description: "MCP session identifier",
        type: "string",
      },
      "mcp.transport": {
        description: "MCP transport protocol used",
        type: "string",
        examples: ["stdio", "http", "websocket"],
      },
      "mcp.request.id": {
        description: "MCP request identifier",
        type: "string",
      },
      "mcp.response.status": {
        description: "MCP response status",
        type: "string",
        examples: ["success", "error"],
      },
    },
  };

  const outputPath = resolve(DATA_DIR, "mcp.json");
  const content = JSON.stringify(
    {
      ...mcpNamespace,
      custom: true, // Mark as custom so it doesn't get overwritten
    },
    null,
    2,
  );

  writeFileSync(outputPath, content);
  console.log("✅ Generated custom MCP namespace");
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  generateNamespaceFiles()
    .then(() => {
      generateMcpNamespace();
      console.log("🎉 OpenTelemetry namespace generation complete!");
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}
