# stdio Release

npm package release process for the MCP server stdio transport.

## Overview

The MCP server is published to npm as `@sentry/mcp-server` for use with:
- Claude Desktop
- Cursor IDE
- VS Code with MCP extension
- Other MCP clients supporting stdio transport

## Package Structure

Published package includes:
- Compiled TypeScript (`dist/`)
- stdio transport implementation
- Type definitions
- Tool definitions

## Release Process

### 1. Version Bump

Update version in `packages/mcp-server/package.json`:

```json
{
  "name": "@sentry/mcp-server",
  "version": "1.2.3"
}
```

Follow semantic versioning:
- **Major**: Breaking changes to tool interfaces
- **Minor**: New tools or non-breaking features
- **Patch**: Bug fixes

### 2. Update Changelog

Document changes in `CHANGELOG.md`:

```markdown
## [1.2.3] - 2025-01-16

### Added
- New `search_docs` tool for documentation search

### Fixed
- Fix context propagation in tool handlers
```

### 3. Quality Checks

**MANDATORY before publishing:**

```bash
pnpm -w run lint:fix    # Fix linting issues
pnpm tsc --noEmit       # TypeScript type checking
pnpm test               # Run all tests
pnpm run build          # Ensure clean build
```

All checks must pass.

### 4. Publish to npm

```bash
cd packages/mcp-server

# Dry run to verify package contents
npm publish --dry-run

# Publish to npm
npm publish
```

### 5. Tag Release

```bash
git tag v1.2.3
git push origin v1.2.3
```

## MCP Registry Publication

The official MCP Registry listing `io.github.getsentry/sentry-mcp` is separate
from npm. Publishing npm alone does not update the listing.

`.github/workflows/mcp-registry.yml` runs when a stable GitHub release is
published. Craft publishes the GitHub target before npm, so the workflow waits
up to 10 minutes for that exact npm version and verifies its `mcpName` before
publishing registry metadata. If npm publishing fails or takes longer, the
registry workflow fails without advertising an unavailable package.

The workflow uses `server.json` on `main` as its metadata template. It replaces
the listing and npm package versions with the selected release version in a
temporary file; the checked-in versions are examples, not a second version to
bump during release preparation. Both local npm installation and the hosted
`https://mcp.sentry.dev/mcp` endpoint are advertised.

Authentication uses GitHub Actions OIDC (`id-token: write`), not a saved token
or the original publisher's account. The registry grants publishing rights for
the GitHub owner's namespace. Keep this job restricted to trusted release
workflows: never execute pull request code with these publishing permissions.
Manual dispatch is restricted to `main`, and the job always checks out `main`
without persisted Git credentials.

### Backfill or Retry

After the workflow is merged to `main`, publish an already-released version:

```bash
gh workflow run mcp-registry.yml --repo getsentry/sentry-mcp --ref main -f version=0.40.0
```

Check the **Publish MCP Registry** Actions run independently of the Craft
publishing run. Registry failures do not undo the npm release or reopen the
Craft publish issue. Once npm is available, rerun the failed job or dispatch it
with the same version. No new npm release is required for a missing listing.

Matching active registry records are skipped safely on retry. An existing
version with different metadata fails: registry versions are immutable, so do
not try to overwrite them. Publish the metadata change with the next stable
release instead. Verification checks the exact version, not `latest`, so
backfilling an older release does not report a false failure when a newer
release is already listed. Downstream directories may take time to refresh.

The publisher binary is pinned by version and SHA-256 in the workflow. Update
both when upgrading it. The registry tooling regression tests run in `test.yml`:

```bash
node --test .github/tests/mcp-registry.test.mjs
```

## User Installation

Users install via npx in their MCP client configuration:

### Claude Desktop

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server"],
      "env": {
        "SENTRY_ACCESS_TOKEN": "sntrys_...",
        "SENTRY_HOST": "sentry.io"
      }
    }
  }
}
```

Config location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Cursor IDE

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server"],
      "env": {
        "SENTRY_ACCESS_TOKEN": "sntrys_...",
        "SENTRY_HOST": "sentry.io"
      }
    }
  }
}
```

## Environment Variables

Required:
- `SENTRY_ACCESS_TOKEN` - Sentry API access token
- `SENTRY_HOST` - Sentry instance hostname (default: `sentry.io`)

Optional:
- `SENTRY_ORG` - Default organization slug
- `SENTRY_PROJECT` - Default project slug
- `MCP_DISABLE_SKILLS` - Disable specific skills, comma-separated (e.g. `seer`)

## Version Pinning

Users can pin to specific versions:

```json
{
  "args": ["-y", "@sentry/mcp-server@1.2.3"]
}
```

## Testing Releases

### Local Testing Before Publishing

Test the built package locally:

```bash
cd packages/mcp-server
npm pack
# Creates sentry-mcp-server-1.2.3.tgz

# Test installation
npm install -g ./sentry-mcp-server-1.2.3.tgz

# Run stdio server
SENTRY_ACCESS_TOKEN=... @sentry/mcp-server
```

### Beta Releases

For testing with users before stable release:

```bash
npm publish --tag beta
```

Users install with:
```json
{
  "args": ["-y", "@sentry/mcp-server@beta"]
}
```

## Troubleshooting

### Package Not Found
- Verify package name: `@sentry/mcp-server` (with scope)
- Check npm registry: `npm view @sentry/mcp-server`

### Version Mismatch
- Users may have cached version: `npx clear-npx-cache`
- Recommend version pinning for stability

### Build Failures
- Ensure `pnpm run build` succeeds before publishing
- Check TypeScript compilation errors
- Verify all dependencies are listed in package.json

## References

- Package config: `packages/mcp-server/package.json`
- stdio transport: `packages/mcp-server/src/transports/stdio.ts`
- Build script: `packages/mcp-server/scripts/build.ts`
- npm publishing docs: https://docs.npmjs.com/cli/publish
