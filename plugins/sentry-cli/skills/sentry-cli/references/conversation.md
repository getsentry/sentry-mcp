---
name: sentry-cli-conversation
version: 0.43.0-dev.0
description: List and view AI conversations
requires:
  bins: ["sentry"]
  auth: true
---

# Conversation Commands

List and view AI conversations

### `sentry conversation list <org>`

List recent AI conversations

**Flags:**
- `-n, --limit <value> - Number of conversations (1-1000) - (default: "25")`
- `-q, --query <value> - Search query`
- `-t, --period <value> - Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `conversationId` | string |  |
| `title` | string \| null |  |
| `flow` | array |  |
| `errors` | number |  |
| `llmCalls` | number |  |
| `toolCalls` | number |  |
| `totalTokens` | number |  |
| `totalCost` | number |  |
| `startTimestamp` | number |  |
| `endTimestamp` | number |  |
| `traceCount` | number |  |
| `traceIds` | array |  |
| `firstInput` | string \| null |  |
| `lastOutput` | string \| null |  |
| `user` | object \| null |  |
| `toolNames` | array |  |
| `toolErrors` | number |  |

**Examples:**

```bash
# List recent AI conversations
sentry conversation list

# Explicit organization
sentry conversation list my-org

# Show more, last 24 hours
sentry conversation list --limit 50 --period 24h

# Filter conversations
sentry conversation list -q "has:errors"

# Paginate through results
sentry conversation list my-org -c next
```

### `sentry conversation view <org/conversation-id>`

View an AI conversation transcript

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# View full transcript
sentry conversation view my-org conv-123

# JSON output
sentry conversation view my-org conv-123 --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
