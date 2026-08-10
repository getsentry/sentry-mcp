# Sentry CLI Skills

Agent skills for using the Sentry CLI, following the [Agent Skills](https://github.com/getsentry/skills) open format.

## Installation

### Claude Code (from GitHub)

```bash
# Add the marketplace
claude plugin marketplace add getsentry/cli

# Install the plugin
claude plugin install sentry/cli
```

### Claude Code (from local clone)

```bash
# Add the marketplace from local clone
claude plugin marketplace add /path/to/sentry/cli

# Install the plugin
claude plugin install sentry/cli
```

After installation, restart Claude Code. The skills will be automatically invoked when relevant to your task.

### Cursor

Skills are automatically available in `.cursor/skills/` for Cursor users.

### Other Agents

Copy the `plugins/sentry-cli/skills/` directory to your agent's skills location, or reference the SKILL.md files directly according to your agent's documentation.

## Available Skills

| Skill | Description |
|-------|-------------|
| [sentry-cli](sentry-cli/skills/sentry-cli/SKILL.md) | Guide for using the Sentry CLI to interact with Sentry |

## Usage

Once installed, ask your AI assistant questions like:

- "How do I list my Sentry issues?"
- "How do I view an issue in Sentry?"
- "How do I authenticate with Sentry CLI?"
- "How do I make API calls to Sentry?"
- "How do I resolve an issue via the CLI?"

The skill will guide the assistant to provide accurate CLI commands.

## Repository Structure

```
cli/                              # Repository root
├── .claude-plugin/
│   └── marketplace.json          # Marketplace manifest
├── .cursor/
│   └── skills/
│       └── sentry-cli/
│           └── SKILL.md          # Symlink to plugins location
├── plugins/
│   ├── README.md                 # This file
│   └── sentry-cli/
│       ├── .claude-plugin/
│       │   └── plugin.json       # Plugin manifest
│       └── skills/
│           └── sentry-cli/
│               └── SKILL.md      # CLI usage skill (auto-generated)
└── script/
    └── generate-skill.ts         # Generates SKILL.md from CLI commands
```

## Updating SKILL.md

The SKILL.md file is **auto-generated** from the CLI's command definitions. Do not edit it manually.

To regenerate after modifying commands:

```bash
pnpm run generate:docs
```

CI will auto-commit updated skill files when they are stale.

## License

FSL-1.1-Apache-2.0
