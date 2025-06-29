# Documentation for Contributors

This directory contains documentation to help LLMs (Language Learning Models) and human contributors work more effectively with the Sentry MCP codebase.

## Purpose

These documents provide structured guidance to ensure consistent, high-quality contributions that align with the project's standards and patterns. All documentation files use the `.mdc` format for better AI tool compatibility.

## Directory Structure

This directory serves a dual purpose:
1. Central documentation repository for all contributors
2. Source for `.cursor/rules/` via symlink (for Cursor IDE integration)

## Contents

### Core Guidelines
- `coding-guidelines.mdc` - Coding standards, patterns, and best practices
- `coding-practices.mdc` - General coding practices and conventions
- `package-management.mdc` - Package and dependency management

### API and Tools
- `adding-new-tools.mdc` - How to add new MCP tools
- `adding-prompts.mdc` - Guidelines for adding new prompts
- `adding-new-resources.mdc` - How to add new MCP resources
- `api-client-patterns.mdc` - Working with the Sentry API client
- `using-api-mocks.mdc` - Testing with API mocks

### Infrastructure and Operations
- `deployment-and-infrastructure.mdc` - Deployment processes and infrastructure
- `observability-and-monitoring.mdc` - Monitoring and telemetry practices
- `security-and-authentication.mdc` - Security best practices

## For LLMs

When working with this codebase:
1. Always read relevant `.mdc` files before making changes
2. Follow the patterns and conventions outlined in these guides
3. Run all quality checks as specified in the guidelines
4. Maintain consistency with existing code

## Integration with Development Tools

### Cursor IDE
The `.cursor/rules/` directory is symlinked to this `docs/` folder, ensuring that Cursor IDE automatically picks up all documentation as contextual rules.

### Other AI Tools
These `.mdc` files are designed to be easily consumed by various AI development assistants and can be referenced directly when needed.

## LLM-Specific Guidelines

The `llms/` subdirectory contains meta-documentation for LLMs:
- `documentation-style-guide.mdc` - How to write effective LLM documentation
- `document-scopes.mdc` - Purpose and content for each doc
- `documentation-todos.mdc` - Tasks for documentation improvement

## Maintenance

These documents should be updated when:
- New patterns or conventions are adopted
- Common issues arise that need documentation
- The architecture or tooling changes significantly
- New tools, resources, or features are added

## Note

This documentation supplements but does not replace the root-level CLAUDE.md file, which remains the primary instruction set for Claude Code when working with this repository. The CLAUDE.md file will be refactored into multiple focused documents within this directory.