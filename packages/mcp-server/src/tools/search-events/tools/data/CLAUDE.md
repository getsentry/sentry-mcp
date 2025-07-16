# OpenTelemetry Namespace Data

This directory contains JSON files for OpenTelemetry semantic convention namespaces used by the search-events tool's embedded AI agent.

## File Format

Each JSON file represents a namespace and follows this structure:

```json
{
  "namespace": "namespace_name",
  "description": "Description of what this namespace covers",
  "attributes": {
    "attribute.name": {
      "description": "What this attribute represents",
      "type": "string|number|boolean",
      "examples": ["example1", "example2"],
      "note": "Additional notes (optional)",
      "stability": "stable|experimental|deprecated (optional)"
    }
  }
}
```

## Generation Process

### OpenTelemetry Official Namespaces

Most files are automatically generated from the OpenTelemetry semantic conventions repository:

**Source**: https://github.com/open-telemetry/semantic-conventions/tree/main/model

The generation script (`scripts/generate-otel-namespaces.ts`) fetches YAML files from the model directory and converts them to our JSON format.

**Generation Command**: `pnpm run generate-otel-namespaces`

**Caching**: The script caches downloaded YAML files in `.cache/` directory to avoid repeated network requests. Clear the cache to force fresh downloads.

### Custom Namespaces

Some namespaces are maintained manually for attributes not yet in the OpenTelemetry specification:

- **mcp.json** - Model Context Protocol attributes (custom)
- Any file marked with `"custom": true` will be skipped during regeneration

## Usage

The `otel-semantics-lookup.ts` tool reads these JSON files to provide semantic guidance to the embedded AI agent when translating natural language queries.

## Key Namespaces

### Core OpenTelemetry Namespaces

- **gen_ai** - Generative AI operations (models, tokens, conversations)
- **db** - Database operations (queries, connections, systems)
- **http** - HTTP client/server operations (requests, responses, status codes)
- **rpc** - Remote procedure calls (gRPC, etc.)
- **messaging** - Message queue operations (Kafka, RabbitMQ, etc.)
- **faas** - Function as a Service operations (AWS Lambda, etc.)
- **k8s** - Kubernetes operations (pods, services, deployments)
- **cloud** - Cloud provider operations (AWS, Azure, GCP)
- **network** - Network operations (TCP, UDP, protocols)
- **server** - Server-side operations (addresses, ports)
- **service** - Service identification (name, version, instance)
- **error** - Error information (type, message, stack)
- **user** - User identification (id, email, name)

### Custom Namespaces

- **mcp** - Model Context Protocol operations (tool calls, sessions)

## Regeneration Process

1. **Automatic**: Run `pnpm run generate-otel-namespaces` to update all OpenTelemetry namespaces
2. **Manual**: Edit custom namespace files directly (they won't be overwritten)
3. **Selective**: The script only updates files for namespaces that exist in the OpenTelemetry repository

## File Organization

```
data/
├── CLAUDE.md              # This documentation
├── gen_ai.json            # Generative AI attributes
├── db.json                # Database attributes  
├── http.json              # HTTP attributes
├── rpc.json               # RPC attributes
├── messaging.json         # Messaging attributes
├── mcp.json               # MCP attributes (custom)
└── [other-namespaces].json
```

## Maintenance

- **OpenTelemetry files**: Regenerate periodically to stay current with specifications
- **Custom files**: Update manually as needed for new MCP or Sentry-specific attributes
- **Validation**: Ensure all files follow the expected JSON schema format

The embedded AI agent uses these definitions to provide accurate semantic guidance when users query for things like "agent calls" (maps to gen_ai.*) vs "tool calls" (maps to mcp.*).