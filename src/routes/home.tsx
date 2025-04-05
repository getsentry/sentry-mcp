import { Hono } from "hono";
import type SentryMCP from "../mcp/server";
import { css, Style } from "hono/css";

const copyPasteHelper = `
const nodes = document.querySelectorAll("[data-copy]");
nodes.forEach((button) => {
  button.addEventListener("click", (e) => {
    const text = button.getAttribute("data-copy");
    navigator.clipboard.writeText(decodeURIComponent(text));
  });
});
`;

const globalStyles = css`
  :root {
    --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",
      "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace;

    --default-font-family: var(--font-sans);
    --default-mono-font-family: var(--font-mono);

    --tw-prose-body: oklch(37.3% 0.034 259.733);
    --tw-prose-headings: oklch(21% 0.034 264.665);
    --tw-prose-links: oklch(21% 0.034 264.665);
    --tw-prose-bold: oklch(21% 0.034 264.665);
    --tw-prose-code: oklch(51% 0.034 264.665);
    --tw-prose-pre-code: oklch(92.8% 0.006 264.531);
    --tw-prose-pre-bg: oklch(27.8% 0.033 256.848);

    --color-white: #fff;
    --color-gray-500: oklch(55.1% 0.027 264.364);
    --color-gray-600: oklch(44.6% 0.03 256.802);
  }

  html {
    font-family: var(
      --default-font-family,
      ui-sans-serif,
      system-ui,
      sans-serif,
      "Apple Color Emoji",
      "Segoe UI Emoji",
      "Segoe UI Symbol",
      "Noto Color Emoji"
    );

    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
  }

  body {
    padding: 2rem;
    background: #fff;
    color: var(--tw-prose-body);
    font-size: 1rem;
    line-height: 1.75;
  }

  h1 {
    color: var(--tw-prose-headings);
    font-weight: 800;
    font-size: 2.25em;
    margin-top: 0;
    margin-bottom: 0.8888889em;
    line-height: 1.1111111;
  }

  p,
  h1,
  h2,
  h3,
  ul,
  ol,
  pre,
  blockquote {
    margin: 1.25rem 0;
  }

  a {
    color: var(--tw-prose-links);
    text-decoration: underline;
    font-weight: 500;
  }

  blockquote {
    font-family: var(
      --default-mono-font-family,
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      "Liberation Mono",
      "Courier New",
      monospace
    );
    font-weight: 600;
    font-size: 0.95rem;
    font-style: italic;
  }

  code {
    font-family: var(
      --default-mono-font-family,
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      "Liberation Mono",
      "Courier New",
      monospace
    );
    font-size: 0.85em;
    color: var(--tw-prose-code);
  }

  pre {
    font-family: var(
      --default-mono-font-family,
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      "Liberation Mono",
      "Courier New",
      monospace
    );
    color: var(--tw-prose-pre-code);
    background-color: var(--tw-prose-pre-bg);
    overflow-x: auto;
    font-weight: 400;
    font-size: 0.875em;
    border-radius: 0.375rem;
    padding: 0.85em 1.15em;
  }

  small {
    font-size: 0.85rem;
  }

  article {
    max-width: 600px;
  }

  button {
    border-radius: 0.25rem;
    border: 0;

    color: var(--color-white);
    background-color: var(--color-gray-600);
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      background-color: var(--color-gray-500);
    }
  }

  section.tools,
  section.workflows {
    ul {
      list-style: none;
      padding: 0;
    }

    h3 {
      font-family: var(
        --default-mono-font-family,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        "Liberation Mono",
        "Courier New",
        monospace
      );
      font-size: 0.95rem;
    }
  }
`;

// This is generated from the list of tools defined in `mcp.ts` in the MCP server itself.
const TOOLS: {
  name: string;
  description: string;
}[] = [
  {
    name: "list_organizations",
    description: "List all organizations that the user has access to in Sentry.",
  },
  {
    name: "list_teams",
    description: "Retrieve a list of teams in Sentry.",
  },
  {
    name: "list_projects",
    description: "Retrieve a list of projects in Sentry.",
  },
  {
    name: "get_error_details",
    description:
      "Retrieve error details from Sentry for a specific Issue ID, including the stacktrace and error message.",
  },
  {
    name: "search_errors_in_file",
    description:
      "Search for errors recently occurring in a specific file. This is a suffix based search, so only using the filename or the direct parent folder of the file. The parent folder is preferred when the filename is in a subfolder or a common filename.",
  },
  {
    name: "create_team",
    description: "Create a new team in Sentry.",
  },
  {
    name: "create_project",
    description: "Create a new project in Sentry, giving you access to a new SENTRY_DSN.",
  },
];

export default new Hono<{
  Bindings: Env & {
    MCP_OBJECT: DurableObjectNamespace<SentryMCP>;
  };
}>().get("/", async (c) => {
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        sentry: {
          command: "npx",
          args: ["mcp-remote", new URL("/sse", c.req.url).href],
        },
      },
    },
    undefined,
    2,
  );

  return c.html(
    <html lang="en">
      <head>
        <title>Sentry MCP</title>
        <Style>{globalStyles}</Style>
      </head>
      <body>
        <article>
          <h1>Sentry MCP</h1>
          <p>
            This service provides a Model Context Provider for interacting with{" "}
            <a href="https://docs.sentry.io/api/">Sentry's API</a>.
          </p>
          <p>
            While this service is maintained by Sentry, it is very much still a proof-of-concept as
            the protocol is still in development (as is our own thinking around its usage).
          </p>
          <div>
            <button type="button" data-copy={mcpSnippet}>
              Copy Configuration
            </button>
            <pre>{mcpSnippet}</pre>
          </div>
          <h3>With Cursor</h3>
          <ol>
            <li>
              <strong>Cmd + Shift + J</strong> to open Cursor Settings.
            </li>
            <li>
              Select <strong>MCP</strong>.
            </li>
            <li>
              Select <strong>Add new global MCP server</strong>.
            </li>
          </ol>
          <h3>With Windsurf</h3>
          <ol>
            <li>Open Windsurf Settings.</li>
            <li>
              Under <strong>Cascade</strong>, you'll find{" "}
              <strong>Model Context Provider Servers</strong>.
            </li>
            <li>
              Select <strong>Add Server</strong>.
            </li>
          </ol>
          <p>
            <small>Note: Windsurf requires an enterprise account to utilize MCP. 😕</small>
          </p>

          <h3>With VSCode</h3>
          <ol>
            <li>CMD+P</li>
            <li>
              Select <strong>MCP: Add Server...</strong>
            </li>
            <li>
              Select <strong>Command (stdio)</strong>.
            </li>
            <li>
              Enter <code>npx mcp-remote https://sentry.cool/sse</code>{" "}
              <button type="button" data-copy="npx mcp-remote https://sentry.cool/sse">
                Copy
              </button>
            </li>
            <li>
              Enter <code>Sentry</code>
            </li>
            <li>
              Select <strong>User settings</strong> or <strong>Workspace settings</strong> (to limit
              to specific project)
            </li>
          </ol>
          <p>
            <small>Note: MCP is supported in VSCode 1.99 and above.</small>
          </p>

          <h2>Workflows</h2>
          <section className="workflows">
            <p>
              Here's a few sample workflows (prompts) that we've tried to design around within the
              provider:
            </p>
            <ul>
              <li>
                <blockquote>
                  Check Sentry for errors in <code>@file.tsx</code> and propose solutions.
                </blockquote>
              </li>
              <li>
                <blockquote>
                  Diagnose issue <code>ISSUE-SHORTID</code> in Sentry and propose solutions.
                </blockquote>
              </li>
              <li>
                <blockquote>
                  Create a new project in Sentry for <code>service-name</code> and setup local
                  instrumentation using it.
                </blockquote>
              </li>
            </ul>
          </section>

          <h2>Available Tools</h2>
          <section className="tools">
            <p>
              <small>
                Note: Any tool that takes an <code>organization_slug</code> parameter will try to
                infer a default organization, otherwise you should mention it in the prompt.
              </small>
            </p>
            <ul>
              {TOOLS.map((tool) => (
                <li key={tool.name}>
                  <h3>{tool.name}</h3>
                  <p>{tool.description}</p>
                </li>
              ))}
            </ul>
          </section>
        </article>

        <h2>Additional Resources</h2>
        <ul>
          <li>
            <a href="https://github.com/getsentry/sentry-mcp">sentry-mcp on GitHub</a>
          </li>
        </ul>
        <script dangerouslySetInnerHTML={{ __html: copyPasteHelper }} />
      </body>
    </html>,
  );
});
