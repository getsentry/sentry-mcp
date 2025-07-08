# Tool Module Refactoring Plan

## Overview
This document outlines the plan to refactor the monolithic tools module into individual tool modules, improving maintainability and AI agent context management.

## Key Principles

1. **NO backwards compatibility** - Clean break from old structure
2. **TOOL_DEFINITIONS export must remain** - Client-side apps (mcp-cloudflare) cannot import server-side code with dependencies like `@sentry/core`
3. **One tool per file** - Maximum ~200 lines for AI agent context management
4. **Use `defineTool` helper** - Consistent pattern with automatic type inference

## Why TOOL_DEFINITIONS Must Be Separate

The mcp-cloudflare web application needs to display tool documentation but cannot import server-side code because:
- Server code has Node.js dependencies (`@sentry/core`, `SentryApiService`, etc.)
- Client-side bundlers would fail on these imports
- We need a clean separation between definition metadata and runtime implementation

## New Directory Structure

```
src/
├── tools/
│   ├── index.ts                    # Barrel export
│   ├── whoami.ts
│   ├── find-organizations.ts
│   ├── find-teams.ts
│   ├── find-projects.ts
│   ├── find-issues.ts
│   ├── find-releases.ts
│   ├── find-tags.ts
│   ├── get-issue-details.ts
│   ├── update-issue.ts
│   ├── find-errors.ts
│   ├── find-transactions.ts
│   ├── create-team.ts
│   ├── create-project.ts
│   ├── update-project.ts
│   ├── create-dsn.ts
│   ├── find-dsns.ts
│   ├── analyze-issue-with-seer.ts
│   ├── search-docs.ts
│   ├── get-doc.ts
│   └── utils/
│       ├── api-service.ts          # apiServiceFromContext function
│       ├── formatting.ts           # formatAssignedTo, formatIssueOutput, etc.
│       └── seer-helpers.ts         # Seer-specific helpers
```

## Type System Changes

### Updated Types
```typescript
// No need for a Tool interface - we'll use type inference from defineTool
```

### Removed Types
- `Tool` - No longer needed, using inference instead
- `ToolName` - Now exported from tools/index.ts
- `ToolParams<T>` - No longer needed
- `ToolHandler<T>` - No longer needed
- `ToolHandlerExtended<T>` - No longer needed
- `ToolHandlers` - No longer needed

## Tool Module Pattern

We use a `defineTool` helper function for consistency and type safety.

### Benefits of defineTool

1. **Type Safety**: Automatic param type inference without boilerplate
2. **Consistency**: All tools follow the same pattern
3. **Future-proofing**: Easy to add features like:
   - Automatic telemetry
   - Parameter validation
   - Tool versioning
   - Middleware support
4. **Refactoring**: Changes to tool structure only require updating one function

### Define Tool Helper

```typescript
// tools/utils/define-tool.ts
import { z } from 'zod';
import type { ServerContext } from '../../types';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Notification } from '@modelcontextprotocol/sdk/types.js';

export function defineTool<
  TName extends string,
  TSchema extends Record<string, z.ZodSchema>
>(config: {
  name: TName;
  description: string;
  paramsSchema: TSchema;
  handler: (
    context: ServerContext,
    params: z.infer<z.ZodObject<TSchema>>,
    extra: RequestHandlerExtra<Request, Notification>
  ) => Promise<string>;
}) {
  return config;
}

// The return type is fully inferred, preserving the literal name type
// and the exact schema structure
```

### Tool Implementation Pattern

```typescript
// tools/[tool-name].ts
import { defineTool } from './utils/define-tool';
import { ParamOrganizationSlug, ParamRegionUrl } from '../schema';
// Import other utilities as needed

// Define params as plain object with Zod schemas
const paramsSchema = {
  organizationSlug: ParamOrganizationSlug,
  regionUrl: ParamRegionUrl.optional(),
  // ... other parameters
};

export default defineTool({
  name: "[tool_name]" as const,
  description: [
    // Multi-line description
  ].join("\n"),
  paramsSchema,
  handler: async (context, params, extra) => {
    // Implementation
    // params is automatically typed based on paramsSchema
  }
});
```

## Barrel Export Structure

```typescript
// tools/index.ts
import whoami from './whoami';
import findOrganizations from './find-organizations';
// ... all 19 tools

// Default export: object mapping tool names to tools
export default {
  whoami,
  find_organizations: findOrganizations,
  find_teams: findTeams,
  // ... all 19 tools mapped by name
} as const;

// Type export
export type ToolName = keyof typeof import('./index').default;
```

## toolDefinitions Strategy - Build-time Generation

**There will be NO toolDefinitions export from the TypeScript code.** Instead, we will generate a static JSON file at build time.

### Implementation
Create a build script that extracts definitions from tools and generates `toolDefinitions.json`:

```typescript
// scripts/generate-tool-definitions.ts
import * as fs from 'fs';
import tools from '../src/tools';

const definitions = Object.entries(tools).map(([key, tool]) => ({
  name: tool.name,
  description: tool.description,
  paramsSchema: extractSchemaDescriptions(tool.paramsSchema)
}));

function extractSchemaDescriptions(schema: Record<string, unknown>): Record<string, { description: string }> {
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  
  return Object.fromEntries(
    Object.entries(schema).map(([key, zodSchema]) => {
      // Extract description from the Zod schema
      let description = '';
      
      if (zodSchema && typeof zodSchema === 'object') {
        // Type assertion for Zod schema shape
        const schemaObj = zodSchema as { description?: string; _def?: { innerType?: { description?: string } } };
        
        // Zod stores description directly on the schema object
        description = schemaObj.description || '';
        
        // For optional schemas, we might need to check the wrapped schema
        if (!description && schemaObj._def?.innerType) {
          description = schemaObj._def.innerType.description || '';
        }
      }
      
      return [key, { description }];
    })
  );
}

fs.writeFileSync('./dist/toolDefinitions.json', JSON.stringify(definitions, null, 2));
```

### Build Process Integration
Add to package.json scripts:
```json
{
  "scripts": {
    "build": "tsdown && npm run generate-tool-definitions",
    "generate-tool-definitions": "tsx scripts/generate-tool-definitions.ts"
  }
}
```

### Client Usage (mcp-cloudflare)
The mcp-cloudflare app will import the generated JSON file:
```typescript
// Instead of: import { TOOL_DEFINITIONS } from "@sentry/mcp-server/toolDefinitions";
import TOOL_DEFINITIONS from "@sentry/mcp-server/dist/toolDefinitions.json";
```

This approach ensures:
- Complete separation of server code from client-importable definitions
- No risk of bundling server dependencies into client code
- Automatic synchronization with actual tool implementations
- Type safety during build process

## Migration Checklist

### Phase 1: Setup
- [x] Create `src/tools/` directory
- [x] Create `src/tools/utils/` directory
- [x] Create tool types in `tools/types.ts`

### Phase 2: Utilities
- [x] Create `tools/utils/defineTool.ts` with the defineTool helper
- [x] Extract `apiServiceFromContext` to `tools/utils/api-utils.ts`
- [x] Extract formatting helpers to `tools/utils/formatting-utils.ts`
- [x] Extract Seer helpers to `tools/utils/seer-utils.ts`

### Phase 3: Tool Migration (19 tools)
1. [x] whoami
2. [x] find_organizations
3. [x] find_teams
4. [x] find_projects
5. [x] find_issues
6. [x] find_releases
7. [x] find_tags
8. [x] get_issue_details
9. [x] update_issue
10. [x] find_errors
11. [x] find_transactions
12. [x] create_team
13. [x] create_project
14. [x] update_project
15. [x] create_dsn
16. [x] find_dsns
17. [x] analyze_issue_with_seer
18. [x] search_docs
19. [x] get_doc

### Phase 4: Integration
- [x] Create `tools/index.ts` barrel export
- [x] Update `server.ts` to use new default import
- [x] Create `scripts/generate-tool-definitions.ts`
- [x] Update package.json build scripts
- [x] Generate initial `toolDefinitions.js`
- [ ] Update mcp-cloudflare to import from JS file
- [x] Test all tools work correctly
- [x] Update tests (tools.test.ts, toolDefinitions.test.ts)
- [x] Delete `tools.ts`
- [x] Delete `toolDefinitions.ts` 
- [x] Remove `/toolDefinitions` export from package.json
- [x] Run full test suite

## Server.ts Updates

```typescript
// Remove old imports
- import { TOOL_HANDLERS } from "./tools";
- import { TOOL_DEFINITIONS } from "./toolDefinitions";

// Add new import
+ import tools from "./tools";

// Update registration loop
for (const tool of Object.values(tools)) {
  server.tool(
    tool.name,
    tool.description,
    tool.paramsSchema,
    async (params, extra) => {
      // Existing telemetry wrapper
      const output = await tool.handler(context, params, extra);
      // Existing error handling
    }
  );
}
```

## Success Criteria

1. All 19 tools migrated to individual files
2. Each file under 200 lines
3. All tests passing
4. toolDefinitions.json generated and importable by mcp-cloudflare
5. Type safety maintained throughout
6. No runtime changes in behavior

## Notes on Implementation

### Zod Schema Shape Extraction
The `tool.paramsSchema.shape` property may not exist on all Zod schemas. The build script should handle:
- `z.object()` schemas (has `.shape`)
- Other Zod types that may not have `.shape`
- Optional parameters and their descriptions

### File Naming Convention
- Use kebab-case for file names (e.g., `find-organizations.ts`)
- Tool names in code remain snake_case (e.g., `find_organizations`)

### Import Paths
- Utilities should be imported as `'./utils/api-service'` from tool files
- Type imports should use `type` keyword: `import type { Tool } from '../types'`

### MCP Registration Details
Based on research, the MCP server expects:
- `paramsSchema` to be a plain object with Zod schemas as values (not a single z.object())
- The SDK handles parameter validation internally
- Empty schemas should be passed as `{}` not `undefined`
- The MCP SDK accepts Zod schemas directly (no JSON Schema conversion needed)

Example paramsSchema format:
```typescript
const paramsSchema = {
  organizationSlug: ParamOrganizationSlug,  // This is a Zod schema
  regionUrl: ParamRegionUrl.optional(),     // This is also a Zod schema
}
```

NOT:
```typescript
const paramsSchema = z.object({  // Don't wrap in z.object()
  organizationSlug: ParamOrganizationSlug,
  regionUrl: ParamRegionUrl.optional(),
})
```

### Tools with No Parameters
Some tools like `whoami` and `find_organizations` have no parameters:
```typescript
import { defineTool } from './utils/define-tool';

const paramsSchema = {};  // Empty object

export default defineTool({
  name: "whoami" as const,
  description: "...",
  paramsSchema,
  handler: async (context, params, extra) => {
    // params will be typed as {}
    return "...";
  }
});
```

### Comments in Empty Schemas
The current codebase includes important comments in empty schemas:
```typescript
paramsSchema: {
  // No regionUrl parameter - user data must always come from the main API server
}
```
These comments should be preserved as they document important API constraints.