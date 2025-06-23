# @sentry/mcp-cloudflare-e2e

Simple end-to-end tests for the Sentry MCP Cloudflare client.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in UI mode
pnpm test:ui

# Run tests in headed mode
pnpm test:headed

# Debug tests
pnpm test:debug
```

## Running from Root

From the project root:

```bash
# Run all e2e tests
pnpm test:e2e

# Open UI mode
pnpm test:e2e:ui
```

## Test Scope

These tests focus on high-level functionality without requiring authentication:

- **Page Loading** - Verifies the application loads without errors
- **Basic Structure** - Checks essential HTML elements exist
- **Responsiveness** - Tests mobile and desktop viewports
- **Meta Tags** - Validates proper HTML meta configuration
- **Title** - Confirms correct page title

## Why Simple Tests?

We intentionally keep these tests simple because:
- OAuth authentication is complex to mock in e2e tests
- Chat functionality requires real Sentry API integration
- Simple tests are more reliable and faster to run
- They catch major regressions without test flakiness

## Configuration

Tests run against:
- Desktop Chrome
- Mobile Safari

The dev server automatically starts on port 5173 before tests run.