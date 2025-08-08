/**
 * About content for the Sentry MCP resource.
 * This provides users with information about the service and what they can do with it.
 */

export const ABOUT_CONTENT = `# About Sentry MCP

## What is Sentry MCP?

The Sentry MCP (Model Context Protocol) service is primarily designed for **human-in-the-loop coding agents**. Our tool selection and priorities are focused on **developer workflows and debugging use cases**, rather than providing a general-purpose MCP server for all Sentry functionality.

This remote MCP server acts as middleware to the upstream Sentry API, optimized for coding assistants like Cursor, Claude Code, and similar development tools.

## Learn More

Visit **<https://mcp.sentry.dev>** for documentation and updates.

## 🚀 Quick Start for Coding Agents

When debugging your application with Sentry MCP:

### Debug a Production Error
User reports an error? Just paste the Sentry link:
- "Analyze https://myorg.sentry.io/issues/PROJECT-123"
- "Get root cause for https://sentry.io/organizations/myorg/issues/5678/"
- "Explain this error: [paste Sentry issue URL]"

### Fix Code Based on Errors
Get AI-powered fixes for your codebase:
- "Analyze issue PROJECT-123 with AI and show me the code fix"
- "What's causing the TypeError in checkout.js line 45?"
- "Fix the database connection error from https://myorg.sentry.io/issues/PROJECT-789"

### Investigate Performance Issues
- "Show me slow API calls in /api/checkout endpoint"
- "Find database queries taking over 1 second"
- "Analyze trace abc123def456 for performance bottlenecks"

## 📊 Real-Time Error Monitoring

Monitor errors while you code:

### Check Error Impact
- "How many users are affected by error PROJECT-456?"
- "Are there new errors in the last deployment?"
- "Show critical errors from production in the last hour"
- "Which errors are happening most frequently?"

### Track Deployments
- "What errors appeared after release v2.1.0?"
- "Show me issues in the latest release"
- "Find errors introduced in commit abc123"

## 🛠 Project Configuration for Development

When setting up error tracking in your code:

### Get Your DSN
- "Get the DSN for my-project" - For configuring Sentry SDK
- "Create a production DSN for my-api" - For environment-specific setup

### SDK Setup Help
- "Search docs for Next.js setup" - Get integration guides
- "How do I configure source maps for React?"
- "Show Python Django integration guide"

## 🎯 Real-World Developer Workflows

### User Reports a Bug
1. User sends you a Sentry link or error ID
2. "Analyze https://myorg.sentry.io/issues/PROJECT-123 with AI"
3. Review the root cause analysis and suggested fixes
4. Apply the fix to your codebase
5. "Resolve issue PROJECT-123" when deployed

### Debugging CI/CD Failures
1. "Show errors from the last hour in staging environment"
2. "What's causing the test failures in auth.js?"
3. "Get stack trace for error EVENT-789"
4. Fix the issue and push your changes

### Performance Optimization
1. "Find the slowest database queries in production"
2. "Show me traces for /api/checkout taking over 2 seconds"
3. "What's the P95 response time for our API?"
4. Optimize based on the bottlenecks found

### Pre-Release Checklist
1. "Are there any unresolved critical errors?"
2. "Show errors from the staging environment today"
3. "What new errors appeared in the last deployment?"
4. Fix any blockers before release

## 💡 Pro Tips

### Working with Issue URLs
Sentry MCP understands multiple URL formats:
- Full URLs: \`https://myorg.sentry.io/issues/PROJECT-123\`
- Organization URLs: \`https://sentry.io/organizations/myorg/issues/5678/\`
- Just paste the link from your browser - it will parse it correctly

### Natural Language is Preferred
The AI understands context:
- "Fix the TypeError in my checkout flow"
- "Why is the database timing out?"
- "Debug the authentication error users are seeing"

### Environment-Specific Queries
- Add "in production" or "in staging" to filter by environment
- "Show errors from the mobile app" to filter by platform
- "Errors affecting Chrome users" for browser-specific issues

## ⚙️ Key Capabilities

### AI-Powered Tools
With OpenAI API key configured:
- **Natural language search** - Find issues and events using plain English
- **Root cause analysis** - Get AI-powered debugging with code fixes via Seer
- **Smart query translation** - Converts natural language to Sentry's query syntax

### Available Resources
- **SDK Documentation** - Access platform-specific setup guides
- **This guide** - Available at \`sentry://about\`

## 📚 Need Help?

- **Report issues**: https://github.com/getsentry/sentry-mcp/issues
- **Documentation**: https://mcp.sentry.dev

---

*Ready to debug? Just describe what you're looking for or paste a Sentry issue URL to get started.*`;
