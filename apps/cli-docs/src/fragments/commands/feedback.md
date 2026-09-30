## Examples

### List User Feedback

Modern User Feedback is stored as Feedback issues. The command always limits
issue searches to `issue.category:feedback`; it does not use the legacy User
Reports API.

```bash
# Auto-detect the organization from the current project
sentry feedback list

# List Feedback for one project
sentry feedback list my-org/frontend

# List Feedback across every project in an organization
sentry feedback list my-org/

# Search for a project across accessible organizations
sentry feedback list frontend
```

The unresolved inbox from the last 14 days is shown by default. Select another
mailbox or expand the time range with flags:

```bash
sentry feedback list my-org/frontend --status resolved
sentry feedback list my-org/frontend --status spam
sentry feedback list my-org/frontend --status all --period 90d
sentry feedback list my-org/frontend --query "message:*checkout*"
```

Use `--json` for the standard paginated envelope. Navigate pages in either
direction with `--cursor next` and `--cursor prev`.

### View User Feedback

```bash
# Most recent unresolved Feedback, with detected or explicit organization
sentry feedback view @latest
sentry feedback view my-org/@latest

# Short ID or numeric ID
sentry feedback view FRONTEND-2SDJ
sentry feedback view 5146636313

# Explicit organization
sentry feedback view my-org/FRONTEND-2SDJ

# `view` is the default command; `show` is an alias
sentry feedback my-org/FRONTEND-2SDJ
sentry feedback show my-org/FRONTEND-2SDJ

# Open the Feedback item in Sentry
sentry feedback view my-org/FRONTEND-2SDJ --web
```

`@latest` selects the most recently active unresolved Feedback.

The detail view includes the complete message and, when available, its latest
event, linked error, Session Replays, and attachment metadata. If the supplied
ID belongs to another issue category, use `sentry issue view` instead.
