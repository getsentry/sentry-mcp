# Self-Hosted Sentry regionUrl Compatibility Fix

## Problem Description

The Sentry MCP server had compatibility issues with self-hosted Sentry installations where the `regionUrl` field in API responses is typically empty or null. This caused validation failures and prevented the MCP server from working correctly with self-hosted Sentry instances.

**Key Issues:**
1. The `ParamRegionUrl` schema required non-empty strings, causing validation failures for empty regionUrl values
2. The `apiServiceFromContext` function didn't handle empty regionUrl values gracefully  
3. The `OrganizationSchema` expected valid URLs for regionUrl, but self-hosted Sentry returns empty strings
4. Tool guidance wasn't clear about when to use regionUrl vs when to omit it

## Root Cause

Self-hosted Sentry installations typically return empty `regionUrl` values in API responses, unlike Sentry SaaS which returns proper region-specific URLs like `https://us.sentry.io`. The MCP server's validation schemas were too strict and didn't account for this difference.

## Solution

### 1. Updated Parameter Schema (`packages/mcp-server/src/schema.ts`)

```typescript
export const ParamRegionUrl = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || z.string().url().safeParse(value).success,
    {
      message: "Must be a valid URL when provided, or empty for self-hosted Sentry"
    }
  )
  .describe(
    "The region URL for the organization you're querying, if known. " +
    "For Sentry SaaS (sentry.io), this is typically the region-specific URL like 'https://us.sentry.io'. " +
    "For self-hosted Sentry installations, this parameter is usually not needed and should be omitted. " +
    "You can find the correct regionUrl from the organization details using the `find_organizations()` tool."
  );
```

**Changes:**
- Added `.refine()` to accept empty strings while validating non-empty values as URLs
- Enhanced description to provide clear guidance for different Sentry installation types
- Maintains URL validation for non-empty values

### 2. Updated API Service Context (`packages/mcp-server/src/tools.ts`)

```typescript
function apiServiceFromContext(
  context: ServerContext,
  opts: { regionUrl?: string } = {},
) {
  let host = context.host;

  // Only use regionUrl if it's provided and not empty (for self-hosted compatibility)
  if (opts.regionUrl && opts.regionUrl.trim() !== "") {
    try {
      host = new URL(opts.regionUrl).host;
    } catch (error) {
      throw new UserInputError(
        `Invalid regionUrl provided: ${opts.regionUrl}. Must be a valid URL.`,
      );
    }
  }

  return new SentryApiService({
    host,
    accessToken: context.accessToken,
  });
}
```

**Changes:**
- Added check for empty strings: `opts.regionUrl.trim() !== ""`
- Empty regionUrl values are now ignored gracefully
- Maintains existing URL validation for non-empty values

### 3. Updated Organization Schema (`packages/mcp-server/src/api-client/schema.ts`)

```typescript
export const OrganizationSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
  links: z.object({
    regionUrl: z.string().refine(
      (value) => value === "" || z.string().url().safeParse(value).success,
      {
        message: "Must be a valid URL or empty string for self-hosted Sentry"
      }
    ),
    organizationUrl: z.string().url(),
  }),
});
```

**Changes:**
- Added `.refine()` to handle empty regionUrl from self-hosted Sentry API responses
- Maintains URL validation for non-empty values from SaaS Sentry

### 4. Enhanced User Guidance (`packages/mcp-server/src/tools.ts`)

```typescript
// Provide clear guidance about regionUrl usage based on the actual values returned
const hasValidRegionUrls = organizations.some(org => org.links.regionUrl && org.links.regionUrl !== "");

if (hasValidRegionUrls) {
  output += `- If a tool supports passing in the \`regionUrl\`, you MUST pass in the correct value shown above for each organization.\n`;
  output += `- For Sentry SaaS (sentry.io), always use the regionUrl to ensure requests go to the correct region.\n`;
} else {
  output += `- This appears to be a self-hosted Sentry installation. You can omit the \`regionUrl\` parameter when using other tools.\n`;
  output += `- For self-hosted Sentry, the regionUrl is typically empty and not needed for API calls.\n`;
}
```

**Changes:**
- Dynamic guidance based on whether organizations have valid regionUrl values
- Clear distinction between SaaS and self-hosted Sentry usage
- Helps LLMs understand when to use regionUrl parameter

## Testing

Added comprehensive test coverage:

```typescript
// packages/mcp-server/src/regionUrl.test.ts
describe("ParamRegionUrl self-hosted compatibility", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(() => ParamRegionUrl.parse("https://us.sentry.io")).not.toThrow();
    expect(() => ParamRegionUrl.parse("https://selfhosted.example.com")).not.toThrow();
  });

  it("accepts empty strings (key fix for self-hosted)", () => {
    expect(() => ParamRegionUrl.parse("")).not.toThrow();
    expect(ParamRegionUrl.parse("")).toBe("");
  });

  it("trims whitespace correctly", () => {
    expect(ParamRegionUrl.parse("  https://us.sentry.io  ")).toBe("https://us.sentry.io");
    expect(ParamRegionUrl.parse("  ")).toBe("");
  });
});
```

## Benefits

1. **Self-hosted Compatibility**: MCP server now works correctly with self-hosted Sentry installations
2. **Backward Compatibility**: All existing functionality for Sentry SaaS remains unchanged
3. **Better LLM Guidance**: Clear, context-aware instructions help LLMs use regionUrl correctly
4. **Robust Validation**: Maintains URL validation for non-empty values while accepting empty strings
5. **Error Prevention**: Graceful handling of empty regionUrl prevents runtime errors

## Impact

This fix resolves the core compatibility issue reported in GitHub issue #230, enabling the Sentry MCP server to work seamlessly with both:
- **Sentry SaaS**: Continues to work with proper region-specific URLs
- **Self-hosted Sentry**: Now works correctly with empty regionUrl values

The fix is backward compatible and doesn't break any existing functionality while adding robust support for self-hosted Sentry installations.
