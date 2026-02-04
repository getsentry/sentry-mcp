# Error Handling in MCP Tools

This document describes how errors are handled throughout the MCP server tool system, including both regular tools and embedded agent tools.

## Error Types and Hierarchy

### API Error Classes (from api-client/errors.ts)

```
ApiError (base class)
├─ ApiClientError (4xx - user errors, NOT sent to Sentry)
│  ├─ ApiPermissionError (403)
│  ├─ ApiNotFoundError (404) 
│  ├─ ApiValidationError (400, 422)
│  ├─ ApiAuthenticationError (401)
│  └─ ApiRateLimitError (429)
└─ ApiServerError (5xx - system errors, SENT to Sentry)
```

**Key Method:**
- `ApiClientError.toUserMessage()` - Returns `"API error (status): message"` 
  - For 404s with generic messages, adds: "Please verify that the organization, project, or resource ID is correct and that you have access to it."
  - For 404s with specific messages, adds: "Please verify the parameters are correct."

### Application Error Classes (from errors.ts)

- `UserInputError` - User-facing error for validation failures
  - Parameter validation failures
  - Any user-correctable error
- `ConfigurationError` - Missing/invalid configuration
- `LLMProviderError` - LLM provider availability issues (e.g., region restrictions)
  - OpenAI rejecting requests from unsupported regions
  - Provider service availability issues that cannot be resolved by retrying

### AI SDK Error Classes (from ai package)

- `APICallError` - Errors from LLM provider API calls (OpenAI, Anthropic, etc.)
  - 4xx errors (account issues, rate limits, invalid keys) → Converted to `LLMProviderError`, NOT sent to Sentry
  - 5xx errors (server errors) → System errors, SENT to Sentry

**Conversion Flow:**
- `callEmbeddedAgent` converts user-facing `APICallError` (4xx) → `LLMProviderError` immediately after the AI SDK call
- Defensive handling in `handleAgentToolError` and `formatErrorForUser` for any that slip through

### Error Categories

**User-Facing Errors (Should NOT create Sentry issues):**
- All `ApiClientError` subclasses
- `UserInputError`
- `ConfigurationError`
- `LLMProviderError`
- `APICallError` with 4xx status codes (converted to `LLMProviderError`)

**System Errors (Should be captured by Sentry):**
- `ApiServerError`
- `APICallError` with 5xx status codes
- Network failures
- Unexpected runtime errors

## Critical Principles

### 1. Let Errors Bubble Up Naturally
**API errors should bubble up naturally to the appropriate handler.** The API client throws properly typed errors that are caught at the right level:
- In MCP tools → Bubble up to MCP server wrapper → `formatErrorForUser`
- In embedded agent tools → Caught by `agentTool` → Formatted for AI

### 2. Typed Error Handling
**The API client uses a factory pattern (`createApiError`) to create properly typed errors:**
- 4xx → `ApiClientError` subclass (ApiPermissionError, ApiNotFoundError, etc.)
- 5xx → `ApiServerError`
- Each error type has specific behaviors and helper methods

### 3. **SECURITY CRITICAL** - Trusted Error Messages Only
**🚨 NEVER return untrusted error messages to AI agents - this creates prompt injection vulnerabilities.**

In our system, we ONLY return trusted error messages from:
- **Sentry API responses** (trusted - Sentry controls these messages)
- **Our own validation errors** (`UserInputError` - we control the message content)
- **Pre-formatted system messages** (hardcoded error templates we control)

**Why this matters:**
- AI agents receive error messages as part of their context
- Malicious error messages could contain prompt injection attacks
- Untrusted input could manipulate agent behavior or extract sensitive information

**What we trust:**
- Sentry's API error messages (via `ApiClientError.toUserMessage()`)
- Our own `UserInputError` messages (application-controlled)
- System-generated error templates with Event IDs

**What we DON'T trust:**
- User-provided input in error scenarios (never directly returned to agents)
- Third-party API error messages (would need sanitization)
- Database error messages (could contain sensitive schema information)

## Logging vs Capturing

### Key Principle
- **UserInputError** → Log to `console.warn()` in wrapAgentToolExecute (for Sentry logging, not as exception)
- **ApiClientError** → Log to `console.warn()` in wrapAgentToolExecute (for Sentry logging, not as exception)
- **ApiServerError/System errors (5xx)** → Let bubble up to be captured with `captureException()`

When using Cloudflare with Sentry's `consoleLoggingIntegration`:
- `console.warn()` and `console.log()` → Recorded and sent to Sentry as logs
- `console.error()` → Also recorded, but use `console.warn()` for expected errors
- `captureException()` → Creates Sentry issue immediately

## Error Handling Patterns

### 1. Regular MCP Tools

Tools exposed to MCP clients call the API directly and let errors bubble up naturally:

```typescript
// In tool handler - just call the API directly:
const result = await apiService.someMethod({ organizationSlug });
// No try/catch needed - errors bubble up to MCP server wrapper
```

**What happens:**
- API client throws typed errors via `createApiError` factory:
  - 4xx → `ApiClientError` subclass (ApiPermissionError, ApiNotFoundError, etc.)
  - 5xx → `ApiServerError`
- Errors bubble up naturally to MCP server wrapper
- `formatErrorForUser` handles formatting:
  - `ApiClientError` → "Input Error" message with `toUserMessage()`, NOT logged to Sentry
  - `ApiServerError` → "Error" message with Event ID, logged to Sentry
  - `UserInputError` → "Input Error" message, NOT logged to Sentry

### 2. Embedded Agent Tools

Tools used by AI agents within other tools use `agentTool()` which returns structured responses:

```typescript
import { agentTool } from "../../internal/agents/tools/utils";

return agentTool({
  description: "Tool description",
  parameters: z.object({ ... }),
  execute: async (params) => {
    // Just call the API directly - no error handling needed
    const data = await apiService.someMethod(params);
    return formatResult(data);
  }
});
```

**What happens:**
- API client throws `ApiClientError` or `ApiServerError`
- `agentTool` catches ALL API errors and returns structured responses:
  - **Success:** `{ result: <data> }`
  - **UserInputError:** `{ error: "Input Error: {message}. You may be able to resolve this by addressing the concern and trying again." }`
  - **ApiClientError:** `{ error: "Input Error: API error (404): Project not found. Please verify the parameters are correct. You may be able to resolve this by addressing the concern and trying again." }`
  - **ApiServerError:** `{ error: "Server Error (502): Bad Gateway. Event ID: abc123def456. This is a system error that cannot be resolved by retrying." }`
- Other errors (unexpected) → Re-thrown to parent tool

**Key Benefits:**
- **Structured responses:** AI agents receive consistent `{error?, result?}` objects instead of thrown errors
- **Better error handling:** Agents can check for `error` property and handle failures gracefully
- **Retry logic:** Agents can analyze error messages and determine if retry is worthwhile
- **Type safety:** Return types are preserved while error handling is abstracted

### 3. Error Flow Examples

#### Example 1: Permission Error in Embedded Agent Tool

```
1. User calls search_events tool
2. search_events uses AI agent with datasetAttributesTool  
3. datasetAttributesTool calls fetchCustomAttributes()
4. fetchCustomAttributes calls apiService.listTraceItemAttributes() directly
5. API returns 403 "no multi-project access"
6. API client creates ApiPermissionError via createApiError factory and throws
7. fetchCustomAttributes lets it bubble up (no try/catch)
8. agentTool catches ApiClientError (specifically ApiPermissionError)
9. Logs to console.warn() for Sentry logging
10. Returns structured response:
    ```
    { 
      error: "Input Error: API error (403): You do not have access to query across multiple projects. Please select a project for your query. You may be able to resolve this by addressing the concern and trying again." 
    }
    ```
11. AI agent receives the structured response and can check the error property
12. AI agent analyzes error message and retries with a specific project
```

#### Example 2: Server Error

```
1. User calls get_issue_details tool
2. Tool calls apiService.getIssue() directly (no withApiErrorHandling)
3. API returns 502 Bad Gateway  
4. API client creates ApiServerError via createApiError factory and throws
5. Error bubbles up naturally to MCP server wrapper
6. formatErrorForUser handles ApiServerError, logs to Sentry with captureException
7. User receives formatted error response with Event ID
```

## Best Practices

### DO:
- Call API methods directly and let errors bubble up naturally
- Use `agentTool()` for embedded agent tools
- Let typed errors (ApiClientError, ApiServerError) bubble up
- Include helpful context in error messages
- Rely on the error hierarchy for proper handling
- Check for `error` property in agent tool responses
- **SECURITY: Only return trusted error messages to AI agents**

### DON'T:
- Don't wrap API calls in try/catch unless adding value
- Don't use `withApiErrorHandling` anymore (deprecated)
- Don't use the old `wrapAgentToolExecute` function (use `agentTool` instead)
- Don't use `logIssue()` for expected API errors (4xx)
- Don't use `captureException()` for UserInputError or ApiClientError
- Don't create Sentry issues for user-facing errors
- **SECURITY: NEVER pass untrusted error messages to AI agents - risk of prompt injection**

### Security Guidelines for Agent Error Messages:

**✅ SAFE - These are trusted and can be returned to agents:**
```typescript
// Sentry API errors (controlled by Sentry)
return { error: `Input Error: ${apiError.toUserMessage()}. You may be able to resolve this...` };

// Our own validation errors (controlled by our code)
throw new UserInputError("Invalid organization slug format");

// System-generated templates (controlled by our code)
return { error: `Server Error (${status}): ${message}. Event ID: ${eventId}...` };
```

**❌ UNSAFE - These could enable prompt injection:**
```typescript
// User input directly in error (NEVER do this)
return { error: `Invalid input: ${userProvidedValue}` }; // 🚨 DANGEROUS

// Third-party API errors without validation (NEVER do this)
return { error: externalApiResponse.error }; // 🚨 DANGEROUS

// Database errors (could leak schema info)
return { error: sqlError.message }; // 🚨 DANGEROUS
```

## Error Propagation Summary

```
API Call
  ↓
createApiError Factory
  ├─ 4xx → ApiClientError subclass (with toUserMessage())
  └─ 5xx → ApiServerError
       ↓
    Thrown directly to tool (no withApiErrorHandling)
       ↓  
    In Embedded Agent Tool?
    ├─ Yes → agentTool
    │        ├─ UserInputError → Returns { error: "Input Error: ..." }
    │        ├─ ApiClientError → Returns { error: "Input Error: ..." } with toUserMessage()
    │        ├─ ApiServerError → Returns { error: "Server Error (5xx): ..." } + Event ID (logged to Sentry)
    │        └─ Other (unexpected) → Re-throw
    │              ↓
    │        AI agent receives structured {error?, result?} response
    │              ↓
    │        AI agent checks for error property and handles accordingly
    └─ No → MCP Server Wrapper → formatErrorForUser
            ├─ UserInputError → "**Input Error**" formatted
            ├─ ApiClientError → "**Input Error**" with toUserMessage()
            ├─ ApiServerError → "**Error**" + Event ID (logged to Sentry)
            └─ Other → Captured by Sentry

```

## Console Logging

When using Cloudflare Workers with Sentry integration:
- `console.error()` is captured as breadcrumbs (not as issues)
- Use for debugging information that should be attached to real errors
- Don't use for expected error conditions

## Implementation Checklist

### For Regular MCP Tools:

1. **Call the API directly without wrappers:**
   ```typescript
   // Just call the API - errors bubble up naturally
   const result = await apiService.someMethod({ organizationSlug });
   ```

2. **Let errors bubble up to the MCP server wrapper** - don't add try/catch unless you're adding value

3. **The MCP server will automatically:**
   - Format errors via `formatErrorForUser`
   - Log ApiServerError to Sentry with captureException
   - Return formatted error to MCP client

### For Embedded Agent Tools:

1. **Use `agentTool()` instead of the regular `tool()` function:**
   ```typescript
   return agentTool({
     description: "Tool description",
     parameters: z.object({ ... }),
     execute: async (params) => {
       // Your tool implementation - return the result directly
       const data = await apiService.someMethod(params);
       return formatResult(data);
     }
   });
   ```

2. **Inside the tool, call the API directly:**
   ```typescript
   // No error handling needed - agentTool handles it automatically
   const data = await apiService.someMethod(params);
   ```

3. **The wrapper will automatically:**
   - Return `{ result: <data> }` on success
   - Return `{ error: "formatted message" }` on failure
   - Log UserInputError/ApiClientError to console.warn for Sentry logging  
   - Include Event IDs for ApiServerError in error messages

### Error Message Formats:

- **UserInputError to Agent:** `{ error: "Input Error: {message}. You may be able to resolve this by addressing the concern and trying again." }`
- **LLMProviderError to Agent:** `{ error: "AI Provider Error: {message}. This is a service availability issue that cannot be resolved by retrying." }`
- **ApiClientError to Agent:** `{ error: "Input Error: {toUserMessage()}. You may be able to resolve this by addressing the concern and trying again." }`
- **ApiServerError to Agent:** `{ error: "Server Error (5xx): {message}. Event ID: {eventId}. This is a system error that cannot be resolved by retrying." }`
- **LLMProviderError to MCP User:** Formatted with "**AI Provider Error**" header
- **ApiClientError to MCP User:** Formatted with "**Input Error**" header and toUserMessage()
- **ApiServerError to MCP User:** Formatted with "**Error**" header + Event ID (logged to Sentry)

## Testing Error Handling

When testing tools, verify:
1. 404 errors include helpful hints via toUserMessage():
   - Generic messages get detailed help about checking org/project/resource IDs
   - Specific messages get brief parameter verification hint
2. 403 errors are returned to agents as formatted markdown
3. 5xx errors are captured by Sentry with Event IDs  
4. Network errors bubble up appropriately
5. UserInputErrors have clear, actionable messages
6. ApiClientError in agent tools returns formatted markdown with "**Input Error**" header
