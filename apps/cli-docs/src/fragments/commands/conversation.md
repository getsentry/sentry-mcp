


## Examples

### List conversations

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

### View a conversation transcript

```bash
# View full transcript
sentry conversation view my-org conv-123

# JSON output
sentry conversation view my-org conv-123 --json
```
