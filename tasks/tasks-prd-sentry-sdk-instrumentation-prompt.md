## Relevant Files

- `packages/mcp-server/src/prompts/promptDefinitions.ts` - Add the new SDK instrumentation prompt definition
- `packages/mcp-server/src/prompts/prompts.ts` - Implement the prompt handler with multi-step workflow
- `packages/mcp-server/src/prompts/prompts.test.ts` - Unit tests for the prompt handler
- `packages/mcp-server/src/internal/projectDetection.ts` - Core logic for detecting project language/framework from dependency files
- `packages/mcp-server/src/internal/projectDetection.test.ts` - Unit tests for project detection logic
- `packages/mcp-server/src/internal/sdkInstrumentation.ts` - Core logic for applying SDK instrumentation to detected projects
- `packages/mcp-server/src/internal/sdkInstrumentation.test.ts` - Unit tests for SDK instrumentation logic
- `packages/mcp-server/src/api-client/schema.ts` - Add any new Zod schemas for SDK instrumentation parameters
- `packages/mcp-server-mocks/src/fixtures/sdkInstrumentation.ts` - Mock data for SDK instrumentation testing
- `packages/mcp-server-mocks/src/routes/sdkContext.ts` - Mock API endpoints for fetching SDK-specific guidelines
- `packages/mcp-server-evals/src/evals/sdkInstrumentation.eval.ts` - Integration tests for the complete instrumentation workflow

### Notes

- Unit tests should be placed alongside the code files they are testing
- Use `cd packages/mcp-server && pnpm vitest --run -u` to run tests and update snapshots after output changes
- Follow existing MCP server patterns for prompt definitions, handlers, and parameter validation

## Tasks

- [ ] 1.0 Set up prompt infrastructure and project detection

  - [ ] 1.1 Add new prompt definition to `promptDefinitions.ts` with name "setup_sentry_instrumentation" and parameters for optional organizationSlug, projectSlug, and targetDirectory
  - [ ] 1.2 Create `projectDetection.ts` module with functions to scan common dependency files (package.json, requirements.txt, go.mod, Cargo.toml, pom.xml)
  - [ ] 1.3 Implement language/framework detection logic that returns detected technologies with confidence scores
  - [ ] 1.4 Add utility functions for file system operations (reading files, checking existence, getting project root)
  - [ ] 1.5 Create Zod schemas for project detection results and SDK configuration parameters
  - [ ] 1.6 Implement ambiguity resolution logic that prompts users when multiple frameworks are detected

- [ ] 2.0 Implement SDK context fetching and language-specific instrumentation logic

  - [ ] 2.1 Create HTTP client utility for fetching SDK-specific guidelines from structured endpoints
  - [ ] 2.2 Implement fallback logic for network failures using built-in SDK knowledge
  - [ ] 2.3 Create `sdkInstrumentation.ts` module with SDK-specific configuration templates for JavaScript/React, Python/Django, Go, Java, C#, PHP, Ruby
  - [ ] 2.4 Implement context caching mechanism to avoid redundant HTTP requests
  - [ ] 2.5 Add SDK version resolution logic (latest stable vs specific versions)
  - [ ] 2.6 Create language-specific initialization code templates with DSN, error tracking, and performance monitoring setup

- [ ] 3.0 Create code modification capabilities for dependency and configuration files

  - [ ] 3.1 Implement dependency addition logic for different package managers (npm/yarn, pip, go mod, maven, nuget, composer, bundler)
  - [ ] 3.2 Create configuration file creation/modification utilities that preserve existing code structure and formatting
  - [ ] 3.3 Add logic to detect and handle existing Sentry installations (upgrade vs duplicate prevention)
  - [ ] 3.4 Implement environment variable configuration setup for DSN and environment settings
  - [ ] 3.5 Create backup/rollback functionality for modified files
  - [ ] 3.6 Add validation logic to verify that modified files are syntactically correct

- [ ] 4.0 Integrate with existing Sentry MCP tools and implement user interaction flow

  - [ ] 4.1 Integrate with `create_project` tool to automatically use newly created project DSN
  - [ ] 4.2 Integrate with `find_organizations` and `find_projects` tools for project selection workflow
  - [ ] 4.3 Add support for region-specific Sentry instances using existing regionUrl patterns
  - [ ] 4.4 Implement user approval workflow that presents detected project details and proposed changes before modification
  - [ ] 4.5 Create the main prompt handler in `prompts.ts` that orchestrates the full workflow (detect → fetch context → propose changes → apply)
  - [ ] 4.6 Add structured markdown response formatting that guides users through next steps and provides follow-up suggestions

- [ ] 5.0 Add comprehensive testing, error handling, and evaluation coverage
  - [ ] 5.1 Create unit tests for project detection logic covering all supported dependency files and edge cases
  - [ ] 5.2 Create unit tests for SDK instrumentation logic with mocked file system operations
  - [ ] 5.3 Set up mock API endpoints in `packages/mcp-server-mocks` for SDK context fetching
  - [ ] 5.4 Create fixture data for different project types and SDK configurations
  - [ ] 5.5 Implement comprehensive error handling with UserInputError for user-facing issues and proper logging for system errors
  - [ ] 5.6 Add integration evaluation tests that test the complete workflow from detection to instrumentation
  - [ ] 5.7 Create rollback functionality and error recovery suggestions for failed instrumentations
  - [ ] 5.8 Add validation that ensures modified projects can still compile/run successfully
