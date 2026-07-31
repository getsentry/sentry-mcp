---
title: Agentic Usage
description: Enable AI coding agents to use the Sentry CLI
---

AI coding agents like Claude Code — and any agent that reads skills from `~/.agents` (such as Cursor) — can use the Sentry CLI through the skill system. This allows agents to interact with Sentry directly from your development environment.

## Automatic Installation

When you install the CLI (via `curl`, Homebrew, or a package manager), `sentry cli setup` automatically installs agent skills into any detected agent root directories (`~/.claude`, `~/.agents`). Skills are also refreshed on `sentry cli upgrade`. No network fetch is needed — skill files are embedded in the binary.

To skip automatic skill installation, pass `--no-agent-skills` to `sentry cli setup`.

## Manual Installation

Add the Sentry CLI skill to your agent manually:

```bash
npx skills add https://cli.sentry.dev
```

This registers the Sentry CLI as a skill that your agent can invoke when needed.

## Capabilities

With this skill, agents can:

- **View issues** - List and inspect Sentry issues from your projects
- **Inspect events** - Look at specific error events and their details
- **AI analysis** - Get root cause analysis and fix plans via Seer AI
- **Browse projects** - List projects and organizations you have access to
- **Explore the API** - Browse API endpoints with `sentry schema` and make arbitrary requests with `sentry api`
- **Make API calls** - Execute arbitrary Sentry API requests
- **Authenticate** - Help you set up CLI authentication

## How It Works

When you ask your agent about Sentry errors or want to investigate an issue, the agent uses CLI commands to fetch real data from your Sentry account. For example:

- "Show me the latest issues in my project" → `sentry issue list`
- "What's the stack trace for ISSUE-123?" → `sentry issue view ISSUE-123`
- "List all projects in my organization" → `sentry project list my-org`
- "What API endpoints exist for releases?" → `sentry schema releases`

The CLI has dedicated commands for most Sentry tasks, so agents should prefer `sentry` commands over constructing raw API calls. The `sentry schema` command provides built-in API exploration, and `sentry api` handles authenticated requests for anything not covered by a dedicated command.

The skill uses your existing CLI authentication, so you'll need to run `sentry auth login` first if you haven't already.

## Requirements

- An authenticated Sentry CLI installation (`sentry auth login`)
- An AI coding agent that supports the skills system (e.g., Claude Code, or any agent that reads from `~/.agents` such as Cursor)
