# Embedded Agent Evals Cleanup Plan

## Overview
This plan outlines the steps to refactor the embedded agent evaluation system to:
1. Use the real agent implementations instead of test-specific versions
2. Properly mock the Sentry API using MSW (Mock Service Worker)
3. Maintain the ability to capture and validate tool calls made by the agents

## Phase 1: Export MSW Mock Infrastructure

### Goal
Expose the MSW mock handlers and utilities from the mcp-server-mocks package so they can be reused in the eval tests.

### Tasks
1. **Update mcp-server-mocks package exports**
   - Already completed: Exported `setupMockServer` and `createMockApiService` from utils.ts
   - Need to verify all necessary mock handlers are included for:
     - `/api/0/organizations/:org/events/meta/` (dataset attributes)
     - `/api/0/organizations/:org/issues/fields/` (issue fields)
     - `/api/0/users/me/` (whoami)
     - OpenTelemetry semantics endpoint (if needed)

2. **Add any missing mock handlers**
   - Check if search_events agent needs additional endpoints
   - Check if search_issues agent needs additional endpoints
   - Ensure mock responses match real API structure

## Phase 2: Refactor Real Agents to Use callEmbeddedAgent

### Goal
Modify the actual search_events and search_issues tools to use our callEmbeddedAgent abstraction while maintaining their current functionality.

### Tasks
1. **Refactor search_events tool**
   - Locate: `packages/mcp-server/src/tools/search-events/`
   - Extract the system prompt, tools, and schema
   - Replace direct `generateText` call with `callEmbeddedAgent`
   - Ensure tool still returns the same response format
   - Handle the captured toolCalls (likely just for logging/debugging)

2. **Refactor search_issues tool**
   - Locate: `packages/mcp-server/src/tools/search-issues/`
   - Extract the system prompt, tools, and schema
   - Replace direct `generateText` call with `callEmbeddedAgent`
   - Ensure tool still returns the same response format
   - Handle the captured toolCalls (likely just for logging/debugging)

3. **Update callEmbeddedAgent location**
   - Move from `packages/mcp-server-evals/src/evals/utils/`
   - To a shared location like `packages/mcp-server/src/internal/agents/`
   - Update imports in both tools

## Phase 3: Update Evals to Test Real Agents

### Goal
Modify the eval tests to import and test the actual agent implementations rather than test-specific versions.

### Tasks
1. **Update eval imports**
   - Import the real `searchEventsAgent` from the MCP server package
   - Import the real `searchIssuesAgent` from the MCP server package
   - Remove imports from `testAgents.ts`

2. **Set up MSW mocking in eval tests**
   - Import `createMockApiService` from mcp-server-mocks
   - Initialize MSW server in test setup
   - Start server before tests, stop after tests
   - Configure appropriate mock responses for each test case

3. **Update test data and expectations**
   - Adjust expected tool call arguments to match real agent behavior
   - Ensure organizationSlug matches what the real agents use
   - Update any other parameters to align with production behavior

## Phase 4: Cleanup and Validation

### Goal
Remove temporary code and ensure all tests pass with the production agent implementations.

### Tasks
1. **Remove test-specific code**
   - Delete `testAgents.ts` file
   - Remove any other test-specific agent implementations

2. **Run comprehensive tests**
   - Execute all eval tests
   - Verify tool calls are captured correctly
   - Ensure mock API responses are sufficient
   - Check that agent outputs match expected results

3. **Documentation**
   - Update AGENT_EVAL_PLAN.md with implementation details
   - Document how to add new eval tests
   - Document how to update mocks when API changes

## Implementation Order

1. **Start with Phase 3** - Set up MSW mocking and try to use real agents
   - This will reveal what's missing or needs adjustment
   - May discover additional mock handlers needed

2. **Phase 1 adjustments** - Add any missing mock handlers discovered

3. **Phase 2 if needed** - Only refactor real agents if absolutely necessary
   - Prefer to keep real agents unchanged if possible
   - May need to export internal functions/types instead

4. **Phase 4** - Final cleanup and validation

## Risks and Mitigations

### Risk 1: Real agents have dependencies not easily mocked
- **Mitigation**: Expand mock handlers as needed
- **Mitigation**: Consider dependency injection if necessary

### Risk 2: Real agents use internal APIs not exported
- **Mitigation**: Export necessary internal APIs from MCP server package
- **Mitigation**: Use module augmentation if needed

### Risk 3: Tool call capture affects agent behavior
- **Mitigation**: Ensure callEmbeddedAgent is transparent
- **Mitigation**: Make tool call capture optional in production

## Success Criteria

1. All eval tests pass using real agent implementations
2. Tool calls are captured and validated correctly
3. No changes to agent behavior in production
4. Clean separation between eval infrastructure and production code
5. Easy to add new eval test cases

## Next Steps

1. Try importing real agents in eval tests
2. Identify what errors occur (missing exports, API calls, etc.)
3. Address issues systematically following this plan