# MCP Prompts Integration

This document describes how MCP prompts are integrated into the web chat agent.

## Overview

MCP prompts provide multi-step workflows and guided interactions for complex Sentry tasks. Since the AI SDK's experimental MCP client doesn't support prompts yet, we've implemented a workaround to expose them to the web chat agent.

## Architecture

### 1. Dedicated Metadata Endpoint

We've created a separate `/api/metadata` endpoint that provides immediate access to MCP prompts and tools:

```typescript
// packages/mcp-cloudflare/src/server/routes/metadata.ts
export default new Hono<{ Bindings: Env }>().get("/", async (c) => {
  // Get prompts directly from MCP server definitions
  const prompts = getMcpPrompts();
  const serializedPrompts = serializePromptsForClient(prompts);
  
  // Get tools by connecting to MCP server
  const mcpClient = await experimental_createMCPClient({...});
  const mcpTools = await mcpClient.tools();
  const tools = Object.keys(mcpTools);

  return c.json({
    type: "mcp-metadata",
    prompts: serializedPrompts,
    tools,
    timestamp: new Date().toISOString(),
  });
});
```

### 2. Client-Side Metadata Hook

A custom React hook fetches metadata immediately when the user authenticates:

```typescript
// packages/mcp-cloudflare/src/client/hooks/use-mcp-metadata.ts
export function useMcpMetadata(authToken: string | null, enabled = true) {
  const [metadata, setMetadata] = useState<McpMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch metadata when auth token changes
  useEffect(() => {
    if (!authToken || !enabled) return;
    
    fetch("/api/metadata", {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    .then(response => response.json())
    .then(setMetadata);
  }, [authToken, enabled]);

  return { metadata, isLoading, error };
}
```

### 3. Prompt Execution in Chat Messages

The chat endpoint processes messages to handle prompt executions:

```typescript
// packages/mcp-cloudflare/src/server/routes/chat.ts
const processedMessages = await Promise.all(
  messages.map(async (message) => {
    // Check if this is a prompt execution message
    if (message.data?.type === "prompt-execution" && message.data.promptName) {
      const { promptName, parameters } = message.data;
      
      // Execute the prompt handler to get the filled template
      const promptContent = await executePromptHandler(
        promptName,
        parameters || {},
        { accessToken, host: c.env.SENTRY_HOST || "sentry.io" }
      );
      
      // Replace message content with the prompt template
      if (promptContent) {
        return {
          ...message,
          content: promptContent,
          data: { ...message.data, wasExecuted: true }
        };
      }
    }
    return message;
  })
);
```

### 4. Enhanced System Prompt

Available prompts are included in the AI agent's system prompt:

```
Available MCP Workflows:
- find_errors_in_file: Use this prompt when you need to find errors in Sentry for a given file.
- fix_issue_with_seer: Use this prompt when you need to fix an issue with Seer.

When users ask about these topics, you can suggest using the appropriate workflow to guide them through complex tasks.
```

## Data Format

The prompts are serialized into a client-friendly format:

```typescript
{
  type: 'mcp-metadata',
  prompts: [
    {
      name: 'find_errors_in_file',
      description: 'Use this prompt when you need to find errors in Sentry for a given file.',
      parameters: {
        organizationSlug: { type: 'string', required: true },
        filename: { type: 'string', required: true }
      }
    }
  ],
  tools: ['find_organizations', 'find_projects', ...]
}
```

## Client Integration

The web UI can access prompt metadata in several ways:

### 1. `/prompts` Slash Command

Users can type `/prompts` in the chat to see all available MCP prompts:

```
/prompts
```

This displays a formatted list with:
- Prompt names and descriptions
- Required and optional parameters
- Parameter types and descriptions
- Usage instructions

### 2. Immediate Metadata Access

The prompt metadata is available immediately when the chat loads through the custom hook:

```typescript
const { metadata, isLoading, error } = useMcpMetadata(authToken, isAuthenticated);

// Access metadata immediately
if (metadata) {
  console.log('Available prompts:', metadata.prompts);
  console.log('Available tools:', metadata.tools);
}

// Handle loading and error states
if (isLoading) console.log('Loading prompts...');
if (error) console.log('Error loading prompts:', error);
```

### 3. Available Slash Commands

The chat UI supports several slash commands:

- `/help` - Show comprehensive help message with usage instructions
- `/prompts` - List all available MCP prompts with detailed information
- `/clear` - Clear all chat messages  
- `/logout` - Log out of the current session

All slash command responses are rendered as proper markdown with formatting, headings, lists, and links.

### 4. Automatic Integration

The AI agent is automatically aware of available prompts through its enhanced system prompt and can suggest appropriate workflows based on user questions.

## Benefits of the New Architecture

1. **Immediate Availability**: Prompts are available instantly when chat loads, before any messages are sent
2. **Better UX**: Loading states and error handling for metadata fetching
3. **Dual Fallback**: Uses dedicated endpoint first, falls back to stream data
4. **Performance**: Single metadata fetch vs. fetching on every chat message
5. **Caching Ready**: Endpoint can easily add caching headers for better performance

## Future Improvements

1. **Response Caching**: Add cache headers to the metadata endpoint
2. **Dynamic Updates**: Support for hot-reloading prompts without server restart
3. **UI Integration**: Build UI components for prompt selection and parameter input
4. **AI SDK Support**: Remove workaround once AI SDK adds native prompt support

## Technical Notes

- Metadata is fetched once per authentication session via `/api/metadata` endpoint
- Zod schemas are converted to simple JSON schemas for client consumption
- Graceful fallback to stream data if metadata endpoint fails
- Loading and error states provide better user experience
- The implementation is designed to be easily removable once AI SDK supports prompts natively