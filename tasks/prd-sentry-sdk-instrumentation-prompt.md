# Product Requirements Document: Sentry SDK Instrumentation Prompt

## Introduction/Overview

This feature adds a new MCP prompt that enables users to seamlessly instrument their projects with Sentry SDKs through natural language requests. The prompt will automatically detect the user's project language/framework, fetch the most up-to-date SDK-specific instrumentation guidelines, and apply basic Sentry setup directly to their codebase.

**Problem Solved:** Eliminates the friction of manually researching, configuring, and implementing Sentry SDK instrumentation by providing an AI agent with current, SDK-specific knowledge that can be applied directly to user codebases.

## Goals

1. **Convenience**: Enable one-command Sentry instrumentation setup through natural language
2. **Accuracy**: Provide up-to-date, SDK-specific instrumentation using live documentation
3. **Integration**: Seamlessly work with existing Sentry MCP tools for complete workflow
4. **Automation**: Automatically detect project type and apply appropriate changes
5. **Extensibility**: Support basic setup initially with ability to add detailed instrumentation on request

## User Stories

**Primary Flow:**

- As a developer, I want to say "Help me set up Sentry for my project" and have the agent automatically detect my stack, confirm the setup, and implement basic Sentry instrumentation so I can start monitoring errors immediately.

**Integration Flow:**

- As a developer using Sentry MCP, I want the instrumentation prompt to work with existing tools like `create_project` so I can get a complete end-to-end setup in one conversation.

**Follow-up Flow:**

- As a developer with basic Sentry setup, I want to ask "Add performance monitoring" or "Add custom error boundaries" and have the agent enhance my existing instrumentation.

**Monorepo Flow:**

- As a developer with a monorepo, I want to specify which part of my project to instrument when the agent detects multiple languages/frameworks.

## Functional Requirements

### Core Detection & Analysis

1. **FR-1**: The system must scan common dependency files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, etc.) to detect project language and framework
2. **FR-2**: The system must identify the appropriate Sentry SDK based on detected technology stack
3. **FR-3**: The system must handle ambiguous detection by asking the user to clarify their preferred SDK

### Context Fetching

4. **FR-4**: The system must fetch SDK-specific instrumentation guidelines from structured endpoints (e.g., `llm.txt` files)
5. **FR-5**: The system must gracefully handle network failures when fetching context, falling back to built-in knowledge
6. **FR-6**: The system must cache fetched context appropriately to avoid redundant requests

### User Interaction

7. **FR-7**: The system must present detected project details and proposed changes to the user before making modifications
8. **FR-8**: The system must allow users to approve or reject the proposed instrumentation
9. **FR-9**: The system must support project-specific configuration (custom DSN, environment, etc.)

### Code Modification

10. **FR-10**: The system must add Sentry SDK dependencies to appropriate package files
11. **FR-11**: The system must create or modify initialization files with basic Sentry setup (DSN, error tracking, performance monitoring)
12. **FR-12**: The system must preserve existing code structure and formatting
13. **FR-13**: The system must handle existing Sentry installations by upgrading/updating configuration rather than duplicating

### Integration with Existing MCP Tools

14. **FR-14**: The system must integrate with `create_project` tool to automatically use created project DSN
15. **FR-15**: The system must integrate with `find_organizations` and `find_projects` for project selection
16. **FR-16**: The system must work with region-specific Sentry instances

### Error Handling

17. **FR-17**: The system must provide clear error messages when project detection fails
18. **FR-18**: The system must validate that modified files compile/run successfully
19. **FR-19**: The system must offer rollback suggestions if instrumentation causes issues

## Non-Goals (Out of Scope)

1. **Complex Custom Instrumentation**: Advanced custom error boundaries, complex performance traces, or business-logic-specific instrumentation (these will be follow-up features)
2. **Multi-Project Monorepo Support**: Instrumenting multiple projects in a single command (focus on single project selection first)
3. **Legacy SDK Versions**: Supporting deprecated or very old SDK versions
4. **Database Integration Setup**: Configuring database-specific Sentry integrations beyond basic ORM detection
5. **Deployment Configuration**: Setting up Sentry in CI/CD pipelines or deployment environments

## Design Considerations

### Supported SDK Matrix (Initial)

- **JavaScript/TypeScript**: React, Node.js, Next.js, Express
- **Python**: Django, Flask, FastAPI
- **Go**: Standard library, Gin, Echo
- **Java**: Spring Boot, standard Java
- **C#/.NET**: ASP.NET Core
- **PHP**: Laravel, Symfony
- **Ruby**: Rails, Sinatra

### User Experience Flow

```
User: "Set up Sentry for my project"
Agent: "I detected a React + Node.js project. I'll set up @sentry/react for frontend and @sentry/node for backend. Should I proceed?"
User: "Yes"
Agent: [Fetches latest React/Node SDK guidelines, modifies package.json, creates/updates init files]
Agent: "Sentry instrumentation complete! Your project is now configured with error tracking and performance monitoring."
```

### File Modification Strategy

- **Package Files**: Add dependencies (package.json, requirements.txt, etc.)
- **Init Files**: Create or modify main entry points with Sentry.init()
- **Configuration**: Use environment variables for DSN and settings
- **Preserve Structure**: Maintain existing code organization and imports

## Technical Considerations

### Context Endpoint Structure

```
https://docs.sentry.io/llm-context/{sdk}/{version}/rules.md
Examples:
- https://docs.sentry.io/llm-context/javascript.react/latest/rules.md
- https://docs.sentry.io/llm-context/python.django/latest/rules.md
```

### Mock Implementation (Phase 1)

- Use the provided React example: `https://raw.githubusercontent.com/getsentry/sentry-docs/60f32dc05ea294107537231ee656908f7d48349f/platform-includes/llm-rules-logs/javascript.react.mdx`
- Create mock endpoints for other SDKs with basic configuration examples
- Implement actual endpoint fetching in Phase 2

### Integration Points

- **SentryApiService**: Use existing API client for project operations
- **Tool Handlers**: Reuse organization/project selection logic
- **Error Handling**: Use existing UserInputError patterns

### Language Detection Priority

1. **Direct Dependencies**: Look for Sentry SDKs already installed
2. **Framework Files**: Next.js config, Django settings, etc.
3. **Package Managers**: package.json, requirements.txt, go.mod
4. **File Extensions**: .js/.ts, .py, .go as fallback

## Success Metrics

1. **Setup Time Reduction**: Reduce average Sentry setup time from 15+ minutes to <2 minutes
2. **Configuration Accuracy**: 95%+ of generated configurations should work without manual fixes
3. **User Satisfaction**: Positive feedback on ease of use compared to manual setup
4. **Adoption**: Integration into 80%+ of Sentry MCP user workflows
5. **Error Rate**: <5% of instrumentation attempts should fail due to code modifications

## Open Questions

1. **Version Management**: How should we handle SDK version selection? Latest stable vs. specific versions?
2. **Environment Configuration**: Should we automatically detect and configure different environments (dev/staging/prod)?
3. **Existing Config Conflicts**: How aggressively should we modify existing Sentry configurations?
4. **Testing Integration**: Should we also set up basic Sentry testing patterns?
5. **Documentation**: Should we generate inline code comments explaining the Sentry setup?

## Implementation Phases

### Phase 1: Core Foundation

- Basic language detection for JavaScript/Python
- Mock context fetching with provided React example
- Simple package.json and init file modifications
- Integration with existing Sentry MCP tools

### Phase 2: Enhanced Context

- Real endpoint integration for fetching SDK-specific guidelines
- Support for additional languages (Go, Java, C#)
- Advanced framework detection

### Phase 3: Advanced Features

- Monorepo support with project selection
- Follow-up instrumentation enhancement
- Custom configuration options
- Rollback capabilities

## Dependencies

- **Existing MCP Server Infrastructure**: Tool definition patterns, handler structure
- **SentryApiService**: For organization and project operations
- **File System Access**: For scanning and modifying project files
- **HTTP Client**: For fetching SDK-specific context
- **Zod Schemas**: For parameter validation and type safety
