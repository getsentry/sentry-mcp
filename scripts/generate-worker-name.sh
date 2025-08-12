#!/bin/bash
#
# Generate a valid Cloudflare Worker name from a branch name
# Usage: ./scripts/generate-worker-name.sh <branch-name>
#
# Cloudflare Worker naming rules:
# - Must start with a letter
# - Can contain letters, numbers, hyphens, and underscores
# - Cannot start or end with hyphens/underscores
# - Must be between 1-63 characters

set -e

if [ $# -eq 0 ]; then
  echo "Usage: $0 <branch-name>" >&2
  exit 1
fi

BRANCH_NAME="$1"

# Sanitize the branch name
# 1. Replace non-alphanumeric characters with hyphens
# 2. Convert to lowercase
SANITIZED=$(echo "$BRANCH_NAME" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')

# 3. Remove leading and trailing hyphens
SANITIZED=$(echo "$SANITIZED" | sed 's/^-*//' | sed 's/-*$//')

# 4. Replace multiple consecutive hyphens with single hyphen
SANITIZED=$(echo "$SANITIZED" | sed 's/--*/-/g')

# 5. Ensure it starts with a letter (prepend 'br' if it starts with a number)
if echo "$SANITIZED" | grep -q '^[0-9]'; then
  SANITIZED="br-$SANITIZED"
fi

# 6. If empty or just hyphens, use default
if [ -z "$SANITIZED" ]; then
  SANITIZED="preview"
fi

# 7. Truncate to max length (20 chars to leave room for prefix)
# This leaves room for "sentry-mcp-preview-" prefix (19 chars)
SANITIZED=$(echo "$SANITIZED" | cut -c1-20)

# 8. Remove any trailing hyphens after truncation
SANITIZED=$(echo "$SANITIZED" | sed 's/-*$//')

# 9. Construct final worker name
WORKER_NAME="sentry-mcp-preview-${SANITIZED}"

echo "$WORKER_NAME"