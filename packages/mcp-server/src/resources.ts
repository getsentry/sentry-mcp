/**
 * MCP Resources for external documentation and reference materials.
 *
 * Defines MCP resources that provide access to external documentation and
 * knowledge bases. Resources enable LLMs to access contextual information
 * during tool execution without embedding large documents in the codebase.
 *
 * @see https://modelcontextprotocol.io/docs/concepts/resources - MCP Resources specification
 *
 * @example Resource Definition
 * ```typescript
 * {
 *   name: "sentry-docs-platform",
 *   template: new ResourceTemplate("https://docs.sentry.io/platforms/{platform}/"),
 *   mimeType: "text/markdown",
 *   description: "Sentry SDK documentation for {platform}",
 *   handler: sentryDocsHandler,
 * }
 * ```
 */
import {
  ResourceTemplate,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { UserInputError } from "./errors";

/**
 * Resource configuration for regular URI resources
 */
export type UriResourceConfig = {
  name: string;
  description: string;
  mimeType: string;
  uri: string;
  handler: ReadResourceCallback;
};

/**
 * Resource configuration for URI template resources
 */
export type TemplateResourceConfig = {
  name: string;
  description: string;
  mimeType: string;
  template: ResourceTemplate;
  handler: ReadResourceCallback; // Changed back to ReadResourceCallback
};

/**
 * Resource configuration with handler function
 */
export type ResourceConfig = UriResourceConfig | TemplateResourceConfig;

/**
 * Type guard to check if a resource uses a URI template
 */
export function isTemplateResource(
  resource: ResourceConfig,
): resource is TemplateResourceConfig {
  return (
    "template" in resource && resource.template instanceof ResourceTemplate
  );
}

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
async function defaultGitHubHandler(
  url: URL,
  _extra: RequestHandlerExtra<any, any>,
): Promise<ReadResourceResult> {
  const rawPath = url.pathname;
  const content = await fetchRawGithubContent(rawPath);
  return {
    contents: [
      {
        uri: url.toString(),
        mimeType: "text/plain",
        text: content,
      },
    ],
  };
}

/**
 * Fetches Sentry documentation in markdown format.
 * Converts docs.sentry.io URLs to their markdown equivalents.
 *
 * The handler receives the exact URI from the resource definition,
 * but dynamically constructs the markdown URL based on the actual request.
 */
async function sentryDocsHandler(
  url: URL,
  _extra: RequestHandlerExtra<any, any>,
): Promise<ReadResourceResult> {
  // The URL passed here is the actual docs.sentry.io URL being requested
  // Transform it to fetch the markdown version
  const path = `${url.pathname.replace(/\/$/, "")}.md`;
  const mdUrl = `${url.origin}${path}`;

  const response = await fetch(mdUrl, {
    headers: {
      "User-Agent": "Sentry MCP Server",
    },
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new UserInputError(
        `Sentry documentation not found at ${url.pathname}. Please check the URL is correct.`,
      );
    }
    throw new Error(
      `Failed to fetch Sentry docs: ${response.status} ${response.statusText}`,
    );
  }

  const content = await response.text();

  return {
    contents: [
      {
        uri: url.toString(),
        mimeType: "text/markdown",
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

// Import platform constants from constants
import { SENTRY_PLATFORMS_BASE, SENTRY_FRAMEWORKS } from "./constants";

export const RESOURCES: ResourceConfig[] = [
  // Platform documentation with dynamic segments
  {
    name: "sentry-docs-platform",
    template: new ResourceTemplate(
      "https://docs.sentry.io/platforms/{platform}/",
      {
        list: async (_extra) => ({
          resources: SENTRY_PLATFORMS_BASE.map((platform) => ({
            uri: `https://docs.sentry.io/platforms/${platform}/`,
            name: `${platform}-docs`,
            description: `Sentry SDK documentation for ${platform}`,
            mimeType: "text/markdown",
          })),
        }),
      },
    ),
    mimeType: "text/markdown",
    description: "Sentry SDK documentation for {platform}",
    handler: sentryDocsHandler,
  } as TemplateResourceConfig,
  {
    name: "sentry-docs-platform-guide",
    template: new ResourceTemplate(
      "https://docs.sentry.io/platforms/{platform}/guides/{framework}/",
      {
        list: async (_extra) => ({
          resources: Object.entries(SENTRY_FRAMEWORKS).flatMap(
            ([platform, frameworks]) =>
              frameworks.map((framework) => ({
                uri: `https://docs.sentry.io/platforms/${platform}/guides/${framework}/`,
                name: `${platform}-${framework}-guide`,
                description: `Sentry integration guide for ${framework} on ${platform}`,
                mimeType: "text/markdown",
              })),
          ),
        }),
      },
    ),
    mimeType: "text/markdown",
    description: "Sentry integration guide for {framework} on {platform}",
    handler: sentryDocsHandler,
  } as TemplateResourceConfig,
];
