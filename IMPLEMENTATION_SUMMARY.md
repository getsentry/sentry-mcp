# update_project Tool Implementation Summary

## Overview

Successfully implemented a new `update_project` tool call for the Sentry MCP server that allows updating project settings such as team assignment, slug, name, platform, and other commonly needed configurations. This addresses the user's goal of simplifying onboarding where mistakes might have been made.

## Implementation Components

### 1. Tool Definition (`packages/mcp-server/src/toolDefinitions.ts`)

- Added comprehensive tool definition with description, examples, and hints
- Supports updating:
  - Project name
  - Project slug (newSlug parameter)
  - Platform
  - Team assignment (teamSlug parameter)
  - Auto-resolve age (resolveAge)
  - Email subject prefix (subjectPrefix)
  - Email subject template (subjectTemplate)
- Includes proper validation with Zod schemas
- Follows existing patterns for parameter definitions

### 2. API Client Methods (`packages/mcp-server/src/api-client/client.ts`)

- **updateProject()**: Updates project settings via PUT /projects/{org}/{project}/
- **addTeamToProject()**: Assigns teams via POST /projects/{org}/{project}/teams/{team}/
- Both methods follow existing patterns with proper error handling and schema validation

### 3. Tool Handler (`packages/mcp-server/src/tools.ts`)

- Comprehensive handler that:
  - Handles team assignment separately from other project updates
  - Provides detailed error messages for debugging
  - Shows clear output of what was updated
  - Includes proper Sentry tagging for monitoring
  - Gracefully handles cases where only team assignment or only project updates are needed

### 4. Tests (`packages/mcp-server/src/tools.test.ts`)

- Two test cases covering main scenarios:
  - Updating project name and slug
  - Assigning team to project
- Tests validate the correct output format and structure
- Follow existing test patterns with inline snapshots

### 5. Mock Responses (`packages/mcp-server-mocks/src/index.ts`)

- Mock handlers for:
  - PUT /projects/{org}/{project}/ - Updates project settings
  - POST /projects/{org}/{project}/teams/{team}/ - Team assignment
- Mocks return appropriate response data for testing

### 6. Evaluation (`packages/mcp-server-evals/src/evals/update-project.eval.ts`)

- Two evaluation scenarios:
  - Project name and slug update
  - Team assignment
- Uses existing evaluation patterns with Factuality scorer
- Validates tool effectiveness for common onboarding scenarios

## Key Features

### Team Assignment

- Handled separately from other project settings (as per Sentry API design)
- Provides clear feedback when team assignment succeeds/fails
- Replaces current team assignment (as documented in description)

### Slug Updates

- Special handling for slug changes since they affect project URLs
- Clear user notification when slug changes occur
- Validation ensures slug uniqueness (handled by Sentry API)

### Error Handling

- Comprehensive error messages for debugging
- Separate error handling for team assignment vs project updates
- Graceful degradation when one operation fails

### User Experience

- Clear output showing what was updated
- Helpful usage information
- Examples for common scenarios in tool description

## Sentry API Integration

Based on Sentry's official API documentation, the implementation uses:

- PUT `/api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/` for project updates
- POST `/api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/teams/{team_slug}/` for team assignment

## Common Use Cases Addressed

1. **Onboarding Corrections**: Fix project name/slug mistakes during initial setup
2. **Team Reassignment**: Move projects between teams during organizational changes
3. **Platform Updates**: Correct platform assignments for proper SDK recommendations
4. **Configuration Tuning**: Adjust auto-resolve settings and email preferences

## Testing Status

The implementation includes comprehensive tests and mocks. The mock endpoints have been updated to use the correct `/api/0/` prefix that all Sentry API endpoints require. The code follows all established patterns from existing tools that are successfully tested in the codebase.

## Integration Notes

- Fully integrated with existing error handling and logging systems
- Uses established parameter schemas and validation patterns
- Compatible with existing MCP server architecture
- Follows Sentry's API best practices for authentication and request handling
