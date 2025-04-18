import type { ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";

async function fetchRawGithubContent(rawPath: string) {
  const path = rawPath.replace("/blob", "");

  return fetch(`https://raw.githubusercontent.com${path}`).then((res) =>
    res.text(),
  );
}

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
