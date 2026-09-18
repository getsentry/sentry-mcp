
## Examples

### List replays

```bash
# List recent replays for a project
sentry replay list my-org/frontend

# Search across all projects in an org
sentry replay list my-org/ --query "environment:production"

# Change the time window and sort
sentry replay list my-org/frontend --period 24h --sort errors

# Paginate through results
sentry replay list my-org/frontend -c next
sentry replay list my-org/frontend -c prev

# Output machine-readable data
sentry replay list my-org/frontend --json
```

### View a replay

```bash
# View a replay by ID using auto-detected org/project context
sentry replay view 346789a703f6454384f1de473b8b9fcc

# View a replay with an explicit org
sentry replay view my-org/346789a703f6454384f1de473b8b9fcc

# View a replay with explicit org/project context
sentry replay view my-org/frontend/346789a703f6454384f1de473b8b9fcc

# Open a replay in the browser
sentry replay view my-org/346789a703f6454384f1de473b8b9fcc --web
```
