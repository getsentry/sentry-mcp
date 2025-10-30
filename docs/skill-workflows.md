# Skill Workflows

Documentation of expected user prompts, workflows, and use cases for each MCP skill. This guide helps with evaluation tests, messaging, and understanding user needs.

## Overview

Skills bundle related tools into user-facing capabilities. Each skill serves specific workflows and user needs.

## Inspect Issues & Events

**Skill ID:** `inspect`
**Default:** ✓ Yes
**Purpose:** Search and view errors, traces, logs, and related data

### Expected User Prompts

- "Show me recent errors in [project]"
- "What errors happened in the last hour?"
- "Find all unresolved issues"
- "Search for database timeout errors"
- "Show me traces for transaction [name]"
- "What's the most common error?"
- "Find issues assigned to me"
- "Show me log entries with severity error"

### Typical Workflows

1. **Error Investigation**
   - User asks about recent errors
   - System searches issues/events
   - User drills into specific error details
   - User examines stack traces and context

2. **Performance Analysis**
   - User searches for slow transactions
   - System returns span data
   - User analyzes duration patterns
   - User identifies bottlenecks

3. **Log Analysis**
   - User searches logs by severity/message
   - System returns matching log entries
   - User examines log context
   - User identifies patterns

4. **Project Exploration**
   - User lists organizations
   - User views projects in org
   - User explores teams
   - User checks DSN configuration

### Key Tools

- `find_organizations` - Foundational navigation
- `find_projects` - Foundational navigation
- `find_teams` - Team viewing
- `find_dsns` - DSN configuration viewing
- `search_events` - Natural language event search
- `search_issues` - Natural language issue search
- `get_issue_details` - Detailed issue information
- `get_trace_details` - Trace analysis

### User Benefits

- Quick access to production errors
- Natural language search (no query syntax needed)
- Comprehensive error context
- Performance bottleneck identification
- Log aggregation and analysis

### Evaluation Scenarios

- Search for errors by message pattern
- Filter issues by status and time range
- Analyze transaction performance
- Investigate log patterns
- Explore project structure

## Documentation

**Skill ID:** `docs`
**Default:** No
**Purpose:** Search and read Sentry SDK documentation

### Expected User Prompts

- "How do I set up Sentry with Next.js?"
- "Show me Django integration docs"
- "How do I configure source maps?"
- "What's the beforeSend configuration option?"
- "How do I implement custom instrumentation?"
- "Show me performance monitoring setup"
- "How do I configure sampling rates?"

### Typical Workflows

1. **SDK Setup**
   - User asks how to integrate Sentry
   - System searches docs for platform
   - Returns setup instructions
   - User follows integration steps

2. **Configuration Help**
   - User asks about config option
   - System searches for specific feature
   - Returns relevant docs
   - User implements configuration

3. **Feature Implementation**
   - User wants to add feature (e.g., source maps)
   - System provides implementation guide
   - User follows code examples
   - User verifies setup

### Key Tools

- `search_docs` - Natural language doc search
- `get_doc` - Fetch full documentation page

### User Benefits

- Quick access to SDK documentation
- No need to leave development environment
- Context-aware help
- Code examples readily available
- Integration guidance

### Evaluation Scenarios

- Find platform-specific setup guides
- Search for configuration options
- Locate code examples
- Find troubleshooting information

## Seer

**Skill ID:** `seer`
**Default:** ✓ Yes
**Purpose:** Sentry's AI debugger that helps you analyze, root cause, and fix issues

### Expected User Prompts

- "What's causing this error?"
- "Help me understand why this is failing"
- "Analyze this production issue"
- "How do I fix this bug?"
- "What's the root cause of [issue]?"
- "Generate a fix for this error"

### Typical Workflows

1. **Error Diagnosis**
   - User encounters confusing error
   - Requests Seer analysis
   - Seer analyzes stack trace and context
   - Returns root cause explanation
   - Provides specific code fixes

2. **Fix Implementation**
   - User receives Seer recommendations
   - Reviews suggested code changes
   - Applies fixes to codebase
   - Verifies resolution

3. **Learning from Errors**
   - User wants to understand error pattern
   - Seer explains technical details
   - User learns about root cause
   - User prevents similar issues

### Key Tools

- `analyze_issue_with_seer` - AI-powered issue analysis

### User Benefits

- Automatic root cause analysis
- Specific code fixes (not generic advice)
- File locations and line numbers
- Step-by-step implementation guidance
- Reduces debugging time
- Educational insights

### Important Notes

- May incur additional costs (AI analysis)
- Analysis takes 2-5 minutes for new issues
- Results are cached for subsequent queries
- Requires sufficient error context (stack traces, etc.)

### Evaluation Scenarios

- Analyze complex production errors
- Generate fix recommendations
- Explain error root causes
- Provide implementation guidance

## Triage Issues

**Skill ID:** `triage`
**Default:** No
**Purpose:** Resolve, assign, and update issues

### Expected User Prompts

- "Mark this issue as resolved"
- "Assign [issue] to [person]"
- "Update the priority of [issue]"
- "Resolve all issues with tag [tag]"
- "Add a comment to [issue]"
- "Change issue status to in progress"

### Typical Workflows

1. **Issue Resolution**
   - User identifies resolved error
   - Updates issue status to resolved
   - Optionally adds resolution notes
   - Issue removed from unresolved list

2. **Issue Assignment**
   - User triages incoming errors
   - Assigns to appropriate team member
   - Sets priority if needed
   - Team member receives notification

3. **Bulk Updates**
   - User identifies pattern in issues
   - Updates multiple issues
   - Changes status or assignments
   - Cleans up issue list

4. **Commenting**
   - User adds context to issue
   - Documents investigation steps
   - Shares findings with team
   - Creates discussion thread

### Key Tools

- `update_issue` - Modify issue properties
- `create_issue_comment` - Add comments

### User Benefits

- Quick issue management
- No need to switch to web UI
- Bulk operations support
- Streamlined triage workflow
- Team collaboration

### Evaluation Scenarios

- Resolve multiple issues
- Assign issues to team members
- Update issue priorities
- Add investigation notes
- Bulk status changes

## Manage Projects & Teams

**Skill ID:** `project-management`
**Default:** No
**Purpose:** Create and modify projects, teams, and DSNs

### Expected User Prompts

- "Create a new project for [app-name]"
- "Add a team for [team-name]"
- "Generate a DSN for [project]"
- "Update project settings"
- "Create a mobile app project"
- "Set up a new microservice in Sentry"

### Typical Workflows

1. **New Project Setup**
   - User starts new application
   - Creates Sentry project
   - Configures platform settings
   - Generates DSN for integration
   - Integrates with application

2. **Team Organization**
   - User creates new team
   - Associates team with projects
   - Sets up access control
   - Manages team membership

3. **DSN Management**
   - User needs new DSN
   - Generates DSN for environment
   - Configures DSN in application
   - Tests integration

4. **Project Configuration**
   - User updates project settings
   - Changes notification preferences
   - Configures integrations
   - Sets sampling rates

### Key Tools

- `create_project` - Create new projects
- `update_project` - Modify project settings
- `create_team` - Create new teams
- `create_dsn` - Generate new DSNs
- `find_dsns` - View existing DSNs

### User Benefits

- Programmatic project setup
- Automation-friendly
- CI/CD integration
- Quick environment setup
- Team organization

### Important Notes

- Requires project:write and team:write permissions
- Changes affect production configuration
- Should be used carefully
- Supports automation workflows

### Evaluation Scenarios

- Create project for new service
- Set up team structure
- Generate DSNs for environments
- Update project configuration
- Automate project setup

## Cross-Skill Workflows

### Complete Error Investigation and Resolution

Combines multiple skills for end-to-end workflows:

1. **Inspect** - Discover the error
   - "Show me errors from the last hour"
   - User finds critical error

2. **Seer** - Understand the issue
   - "Analyze this error"
   - Receives root cause and fix

3. **Docs** (if needed) - Learn how to implement fix
   - "How do I configure [feature]?"
   - Gets implementation guidance

4. **Triage** - Resolve the issue
   - "Mark as resolved"
   - Issue closed after fix deployed

### New Service Onboarding

1. **Project Management** - Set up infrastructure
   - "Create project for new service"
   - "Generate DSN"

2. **Docs** - Integration guidance
   - "How do I integrate Sentry with [platform]?"
   - Gets setup instructions

3. **Inspect** - Verify setup
   - "Show me events from [new-project]"
   - Confirms data flowing

## Evaluation Test Planning

### Priority Areas for Testing

1. **Natural Language Understanding**
   - Test search_events with various phrasings
   - Test search_issues with different filters
   - Verify AI agents interpret user intent correctly

2. **Workflow Completeness**
   - Test multi-step workflows
   - Verify skill interactions
   - Ensure tools provide necessary context

3. **Error Handling**
   - Test with missing permissions
   - Test with invalid parameters
   - Verify helpful error messages

4. **Performance**
   - Measure query response times
   - Test with large result sets
   - Verify pagination works

### Recommended Eval Scenarios

Each skill should have 2-3 evaluation scenarios covering:
- Common use case (happy path)
- Edge case (error handling)
- Complex workflow (multi-step)

See `packages/mcp-server-evals/` for implementation.

## Messaging and Documentation

### Skill Descriptions for Users

Use the "User Benefits" sections above for:
- OAuth approval dialog descriptions
- Marketing materials
- User documentation
- Onboarding guides

### Default Skill Justification

**Inspect & Seer are default because:**
- Core error monitoring use case
- Read-only (safe by default)
- Immediate value for users
- No destructive operations
- Primary workflows (finding and fixing errors)

**Documentation, Triage, and Project Management are optional because:**
- Secondary use cases
- Not needed by all users
- Use case dependent
- Write operations (Triage & Project Management require explicit consent)

## References

- Skill definitions: `packages/mcp-server/src/skills.ts`
- Tool implementations: `packages/mcp-server/src/tools/`
- Authorization guide: `docs/authorization.md`
- Testing guide: `docs/testing.mdc`
