/**
 * MCP Resources for external documentation and reference materials.
 *
 * Defines MCP resources that provide access to external documentation and
 * knowledge bases. Resources enable LLMs to access contextual information
 * during tool execution without embedding large documents in the codebase.
 *
 * @example Resource Definition
 * ```typescript
 * {
 *   name: "sentry-query-syntax",
 *   uri: "https://github.com/getsentry/sentry-ai-rules/blob/main/api/query-syntax.mdc",
 *   mimeType: "text/plain",
 *   description: "Sentry search query syntax reference for filtering issues and events.",
 *   handler: defaultGitHubHandler,
 * }
 * ```
 */
import type { ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Fetches raw content from GitHub repositories.
 * Converts GitHub blob URLs to raw content URLs.
 */
async function fetchRawGithubContent(rawPath: string) {
  const path = rawPath.replace("/blob", "");

  return fetch(`https://raw.githubusercontent.com${path}`).then((res) =>
    res.text(),
  );
}

/**
 * Default handler for GitHub-hosted resources.
 * Converts GitHub blob URLs to raw content URLs and returns MCP resource format.
 */
async function defaultGitHubHandler(url: URL): Promise<ReadResourceResult> {
  const uri = url.host;
  const rawPath = url.pathname;
  const content = await fetchRawGithubContent(rawPath);
  return {
    contents: [
      {
        uri: uri,
        mimeType: "text/plain",
        text: content,
      },
    ],
  };
}

/**
 * Registry of all MCP resources available to LLMs.
 * Defines external documentation and reference materials with their handlers.
 */
// XXX: Try to keep the description in sync with the MDC file itself
// Note: In an ideal world these would live on-disk in this same repo and we'd
// simply parse everything out, but given we're running the service on cloudflare
// and the author barely knows TypeScript, we're opting for a solution we've
// seen employed elsewhere (h/t Neon)
export const RESOURCES = [
  {
    name: "sentry-query-syntax",
    uri: "https://github.com/getsentry/sentry-ai-rules/blob/main/api/query-syntax.mdc",
    mimeType: "text/plain",
    description:
      "Use these rules to understand common query parameters when searching Sentry for information.",
    handler: defaultGitHubHandler,
  },
] satisfies (Resource & { handler: ReadResourceCallback })[];
