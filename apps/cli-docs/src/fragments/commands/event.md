


## Examples

### Sending Events

```bash
# Send an error event (default level)
sentry event send -m "Something went wrong"

# Specify level, release, and environment
sentry event send -m "Deploy check" -l info -r 1.0.0 -E production

# Add tags and extra data
sentry event send -m "Payment failed" --tag env:prod --tag region:us-east --extra amount:99.99

# Set user context
sentry event send -m "Login error" --user id:42 --user email:alice@example.com

# Custom fingerprint to group related events together
sentry event send -m "DB timeout" --fingerprint db-timeout --fingerprint {{ default }}
```

### Send from a JSON file

```bash
# Send a serialized Sentry Event object
sentry event send ./crash.json

# Send without re-parsing (raw mode — also supports pre-built envelopes)
sentry event send --raw ./crash.json
sentry event send --raw ./captured.envelope
```

### DSN authentication

`sentry event send` authenticates via a **DSN** rather than a user token.
No `sentry auth login` is required.

The DSN is resolved in priority order:

1. `--dsn <value>` flag (explicit)
2. `SENTRY_DSN` environment variable

```bash
# Explicit DSN
sentry event send -m "Test" --dsn "https://key@o123.ingest.us.sentry.io/456"

# Via environment variable
export SENTRY_DSN="https://key@o123.ingest.us.sentry.io/456"
sentry event send -m "Test"
```

### Listing Events

```bash
# List events for an issue (using short ID)
sentry event list PROJ-ABC

# List events for an issue (using numeric ID)
sentry event list 123456789

# Filter by search query
sentry event list PROJ-ABC --query "browser:Chrome"

# Include full event bodies (stacktraces)
sentry event list PROJ-ABC --full

# Limit results and time range
sentry event list PROJ-ABC --limit 50 --period 24h

# Paginate through results
sentry event list PROJ-ABC -c next
sentry event list PROJ-ABC -c prev

# Output as JSON
sentry event list PROJ-ABC --json
```

### Viewing Events

```bash
sentry event view abc123def456abc123def456abc12345
```

```
Event: abc123def456abc123def456abc12345
Issue: FRONT-ABC
Timestamp: 2024-01-20 14:22:00

Exception:
  TypeError: Cannot read property 'foo' of undefined
    at processData (app.js:123:45)
    at handleClick (app.js:89:12)
    at HTMLButtonElement.onclick (app.js:45:8)

Tags:
  browser: Chrome 120
  os: Windows 10
  environment: production
  release: 1.2.3

Context:
  url: https://example.com/app
  user_id: 12345
```

```bash
# Open in browser
sentry event view abc123def456abc123def456abc12345 -w
```

## Finding Event IDs

Event IDs can be found:

1. In the Sentry UI when viewing an issue's events
2. In the output of `sentry issue view` commands
3. In error reports sent to Sentry (as `event_id`)

## Backward compatibility

The old sentry-cli top-level command is available as a hidden alias:

```bash
sentry send-event    # same as: sentry event send
```
