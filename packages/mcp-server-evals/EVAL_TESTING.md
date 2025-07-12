# Evaluation Testing Quick Reference

## Running Eval Tests

### Prerequisites
```bash
# Set up environment
echo "OPENAI_API_KEY=your-key-here" >> .env

# Build the project
cd /path/to/sentry-mcp
pnpm run build
```

### Common Commands

```bash
# Run all evals
pnpm test

# Run specific eval file
pnpm exec vitest run src/evals/search-events.eval.ts

# Run single test
pnpm exec vitest run src/evals/list-issues.eval.ts -t "jane@sentry.io"

# Debug with verbose output
pnpm exec vitest run src/evals/search-events.eval.ts --reporter=verbose

# Increase timeout for slow tests
pnpm exec vitest run src/evals/search-events.eval.ts --test-timeout=60000
```

## Troubleshooting

### Test Timeouts
- Default timeout is 30 seconds
- search_events tests can be slow (OpenAI API calls)
- Increase timeout or run tests individually

### Failing Tests
1. Check if the AI is using the correct tool
2. Verify mock data matches expectations
3. Review the Factuality scorer rationale
4. Run with `--reporter=tap` for cleaner output

### Tool Selection Issues
- AI might choose `find_issues` instead of `search_events`
- Check tool descriptions in source files
- Rebuild after changes: `pnpm run build`

## Test Structure

```typescript
describeEval("tool-name", {
  data: async () => [
    {
      input: "What the user would ask",
      expected: "Key content to verify"
    }
  ],
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,  // 60% similarity required
  timeout: 60000   // 60 seconds
});
```

## Best Practices

1. **Be Specific**: Include org/project names in inputs
2. **Flexible Expectations**: Match key content, not exact format
3. **Clear Intent**: Make it obvious which tool should be used
4. **Test Individually**: Debug one test at a time
5. **Check Mocks**: Ensure mock data supports your test case

## Common Issues

### "Score below threshold"
- The Factuality scorer is strict
- Check if output contains expected keywords
- Consider lowering threshold if appropriate

### "Command timed out"
- Eval tests can be slow (AI processing)
- Run problematic tests individually
- Increase timeout for complex queries

### Wrong tool selected
- Update tool descriptions to be clearer
- Rebuild the project after changes
- Check `dist/toolDefinitions.js`