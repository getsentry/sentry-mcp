## Testing Strategy

### Unit Test Structure

```typescript
describe("tool_name", () => {
  it("handles successful case", async () => {
    const tool = TOOL_HANDLERS.tool_name;
    const result = await tool(mockContext, {
      organizationSlug: "test-org",
      param: "value",
    });
    
    expect(result).toMatchInlineSnapshot(`
      "Expected markdown output"
    `);
  });

  it("validates required parameters", async () => {
    const tool = TOOL_HANDLERS.tool_name;
    
    await expect(
      tool(mockContext, { organizationSlug: null })
    ).rejects.toThrow(UserInputError);
  });
});
```

### Updating Snapshots After Tool Output Changes

**Critical: When you modify tool output formatting or content, always run tests to update snapshots:**

```bash
cd packages/mcp-server
pnpm vitest --run -u
```

This is required after any changes to:
- Tool response formatting or structure
- Output content or data fields  
- Error message text
- Markdown formatting in responses

Failing to update snapshots will cause unit tests to fail and break the build. Always run this command after modifying tool handlers that change output format.
