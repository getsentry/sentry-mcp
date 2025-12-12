# Common Patterns

Reusable patterns used throughout the Sentry MCP codebase. Reference these instead of duplicating.

## Error Handling

### UserInputError Pattern

For invalid user input that needs clear feedback:

```typescript
if (!params.organizationSlug) {
  throw new UserInputError(
    "Organization slug is required. Please provide an organizationSlug parameter. " +
    "You can find available organizations using the `find_organizations()` tool."
  );
}
```

See implementation: `packages/mcp-server/src/errors.ts`

### API Error Wrapping

When external API calls fail:

```typescript
try {
  const data = await apiService.issues.list(params);
  return data;
} catch (error) {
  throw new Error(`Failed to fetch issues: ${error.message}`);
}
```

### Error Message Transformation

Make error messages LLM-friendly:

```typescript
if (message.includes("You do not have the multi project stream feature enabled")) {
  return "You do not have access to query across multiple projects. Please select a project for your query.";
}
```

## Zod Schema Patterns

### Reusable Parameter Schemas

Define once, use everywhere:

```typescript
export const ParamOrganizationSlug = z
  .string()
  .trim()
  .describe("The organization's slug. You can find a list using the `find_organizations()` tool.");

export const ParamRegionUrl = z
  .string()
  .url()
  .optional()
  .describe("Sentry region URL. If not provided, uses default region.");
```

See: `packages/mcp-server/src/schema.ts`

### Flexible Schema Patterns

```typescript
// Support multiple ID formats
z.union([z.string(), z.number()])

// Optional with transforms
z.string().optional().transform(val => val?.trim())

// Partial objects with passthrough
IssueSchema.partial().passthrough()
```

### Type Derivation

```typescript
export type Organization = z.infer<typeof OrganizationSchema>;
export type ToolParams<T> = z.infer<typeof toolDefinitions[T].parameters>;
```

## Testing Patterns

For comprehensive testing guidance, see `testing.md` and `adding-tools.md#step-3-add-tests`.

### Unit Test Structure

```typescript
describe("tool_name", () => {
  it("returns formatted output", async () => {
    const result = await TOOL_HANDLERS.tool_name(mockContext, {
      organizationSlug: "test-org",
    });
    
    expect(result).toMatchInlineSnapshot(`
      "# Results in **test-org**
      
      Expected formatted output here"
    `);
  });
});
```

### Snapshot Updates

When tool output changes:

```bash
cd packages/mcp-server
pnpm vitest --run -u
```

### Mock Server Setup

```typescript
beforeAll(() => mswServer.listen());
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

See: `packages/mcp-server/src/test-utils/setup.ts`

## API Patterns

For complete API usage patterns, see `api-patterns.md`.

### Service Creation

```typescript
const apiService = apiServiceFromContext(context, {
  regionUrl: params.regionUrl,
});
```

See: `packages/mcp-server/src/api-utils.ts:apiServiceFromContext`

### Multi-Region Support

```typescript
if (opts.regionUrl) {
  try {
    host = new URL(opts.regionUrl).host;
  } catch (error) {
    throw new UserInputError(
      `Invalid regionUrl provided: ${opts.regionUrl}. Must be a valid URL.`
    );
  }
}
```

## Response Formatting

### Markdown Structure

```typescript
let output = `# ${title}\n\n`;

// Handle empty results
if (data.length === 0) {
  output += "No results found.\n";
  return output;
}

// Add data sections
output += "## Section\n";
output += formatData(data);

// Add usage instructions
output += "\n\n# Using this information\n\n";
output += "- Next steps...\n";
```

### Multi-Content Resources

```typescript
return {
  contents: [
    {
      uri: url.toString(),
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2)
    }
  ]
};
```

## Parameter Validation

### Required Parameters

```typescript
if (!params.requiredParam) {
  throw new UserInputError(
    "Required parameter is missing. Please provide requiredParam."
  );
}
```

### Multiple Options

```typescript
if (params.issueUrl) {
  // Extract from URL
} else if (params.organizationSlug && params.issueId) {
  // Use direct parameters
} else {
  throw new UserInputError(
    "Either issueUrl or both organizationSlug and issueId must be provided"
  );
}
```

## Mock Patterns

### Basic Handler

```typescript
{
  method: "get",
  path: "/api/0/organizations/:orgSlug/issues/",
  fetch: ({ params }) => {
    return HttpResponse.json(issueListFixture);
  },
}
```

### Request Validation

```typescript
fetch: ({ request, params }) => {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort");
  
  if (sort && !["date", "freq", "new"].includes(sort)) {
    return HttpResponse.json("Invalid sort parameter", { status: 400 });
  }
  
  return HttpResponse.json(data);
}
```

See: `packages/mcp-server-mocks/src/handlers/`

## Quality Checks

Required before any commit:

```bash
pnpm -w run lint:fix    # Fix linting issues
pnpm tsc --noEmit       # TypeScript type checking
pnpm test               # Run all tests
```

## TypeScript Helpers

### Generic Type Utilities

```typescript
// Extract Zod schema types from records
type ZodifyRecord<T extends Record<string, any>> = {
  [K in keyof T]: z.infer<T[K]>;
};

// Const assertions for literal types
export const TOOL_NAMES = ["tool1", "tool2"] as const;
export type ToolName = typeof TOOL_NAMES[number];
```

## References

- Error handling: `packages/mcp-server/src/errors.ts`
- Schema definitions: `packages/mcp-server/src/schema.ts`
- API utilities: `packages/mcp-server/src/api-utils.ts`
- Test setup: `packages/mcp-server/src/test-utils/`
- Mock handlers: `packages/mcp-server-mocks/src/handlers/`