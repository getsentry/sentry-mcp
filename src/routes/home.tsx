import { Hono } from "hono";
import { css, Style } from "hono/css";
import { TOOL_DEFINITIONS } from "../mcp/tools";

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
    font-family: var(--default-font-family);

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

  main {
    display: flex;
    flex-direction: row;
    gap: 1rem;
    max-width: 1000px;

    article {
      flex: 1;
    }

    /** TODO: Make this sticky */
    nav {
      width: 200px;

      li ul {
        margin-bottom: 0;
      }
    }
  }

  @media only screen and (max-width: 800px) {
    article {
      margin-right: 0;
    }

    nav {
      display: none;
    }
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
  dl,
  pre,
  blockquote {
    margin: 0 0 1.25rem;
  }

  a {
    color: var(--tw-prose-links);
    text-decoration: underline;
    font-weight: 500;
  }

  blockquote {
    font-family: var(--default-mono-font-family);
    font-weight: 600;
    font-size: 0.95rem;
    font-style: italic;
  }

  code {
    font-family: var(--default-mono-font-family);
    font-size: 0.85em;
    color: var(--tw-prose-code);
  }

  pre {
    font-family: var(--default-mono-font-family);
    color: var(--tw-prose-pre-code);
    background-color: var(--tw-prose-pre-bg);
    overflow-x: auto;
    font-weight: 400;
    font-size: 0.875em;
    border-radius: 0.375rem;
    padding: 0.85em 1.15em;
  }

  .snippet {
    position: relative;

    button {
      position: absolute;
      right: 0.855rem;
      top: 0.85rem;
    }
  }

  small {
    font-size: 0.85rem;
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
      font-family: var(--default-mono-font-family);
      font-size: 0.95rem;
    }

    .params {
    }
  }
`;

export default new Hono<{
  Bindings: Env;
}>().get("/", async (c) => {
  const sseUrl = new URL("/sse", c.req.url).href;
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        sentry: {
          command: "npx",
          args: ["-y", "mcp-remote", sseUrl],
        },
      },
    },
    undefined,
    2,
  );

  const zedInstructions = JSON.stringify(
    {
      context_servers: {
        sentry: {
          command: {
            command: "npx",
            args: ["-y", "mcp-remote", sseUrl],
          },
        },
        settings: {},
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
        <div class="container">
          <header>
            <h1>Sentry MCP</h1>
          </header>
          <main>
            <article>
              <div id="top" />
              <p>
                This service provides a Model Context Provider for interacting
                with <a href="https://docs.sentry.io/api/">Sentry's API</a>.
              </p>
              <p>
                While this service is maintained by Sentry, it is very much
                still a proof-of-concept as the protocol is still in development
                (as is our own thinking around its usage).
              </p>
              <div class="snippet">
                <button type="button" data-copy={mcpSnippet}>
                  Copy Configuration
                </button>
                <pre>{mcpSnippet}</pre>
              </div>
              <p>
                Or if you just need the server itself (requires an OAuth
                compatible client):
              </p>
              <div class="snippet">
                <button type="button" data-copy={sseUrl}>
                  Copy Configuration
                </button>
                <pre>{sseUrl}</pre>
              </div>

              <section className="setup-guide">
                <h3 id="with-cursor">With Cursor</h3>
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
              </section>

              <section className="setup-guide">
                <h3 id="with-windsurf">With Windsurf</h3>
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
                  <small>
                    Note: Windsurf requires an enterprise account to utilize
                    MCP. 😕
                  </small>
                </p>
              </section>

              <section className="setup-guide">
                <h3 id="with-vscode">With VSCode</h3>
                <ol>
                  <li>
                    <strong>CMD + P</strong>
                  </li>
                  <li>
                    Select <strong>MCP: Add Server...</strong>
                  </li>
                  <li>
                    Select <strong>Command (stdio)</strong>.
                  </li>
                  <li>
                    Enter <code>npx mcp-remote {sseUrl}</code>{" "}
                    <button
                      type="button"
                      data-copy={`npx mcp-remote ${sseUrl}`}
                    >
                      Copy
                    </button>
                  </li>
                  <li>
                    Enter <code>Sentry</code>
                  </li>
                  <li>
                    Select <strong>User settings</strong> or{" "}
                    <strong>Workspace settings</strong> (to limit to specific
                    project)
                  </li>
                </ol>
                <p>
                  <small>
                    Note: MCP is supported in VSCode 1.99 and above.
                  </small>
                </p>
              </section>

              <section className="setup-guide">
                <h3 id="with-zed">With Zed</h3>
                <ol>
                  <li>
                    <strong>CMD + ,</strong> to open Zed settings.
                  </li>
                  <li>
                    <div className="snippet">
                      <button type="button" data-copy={zedInstructions}>
                        Copy
                      </button>
                      <pre>{zedInstructions}</pre>
                    </div>
                  </li>
                </ol>
              </section>

              <section className="workflows" id="workflows">
                <h2>Workflows</h2>
                <p>
                  Here's a few sample workflows (prompts) that we've tried to
                  design around within the provider:
                </p>
                <ul>
                  <li>
                    <blockquote>
                      Check Sentry for errors in <code>@file.tsx</code> and
                      propose solutions.
                    </blockquote>
                  </li>
                  <li>
                    <blockquote>
                      Diagnose issue <code>ISSUE_URL</code> in Sentry and
                      propose solutions.
                    </blockquote>
                  </li>
                  <li>
                    <blockquote>
                      Create a new project in Sentry for{" "}
                      <code>service-name</code> and setup local instrumentation
                      using it.
                    </blockquote>
                  </li>
                </ul>
              </section>

              <section className="tools" id="tools">
                <h2>Available Tools</h2>
                <p>
                  <small>
                    Note: Any tool that takes an <code>organization_slug</code>{" "}
                    parameter will try to infer a default organization,
                    otherwise you should mention it in the prompt.
                  </small>
                </p>
                <ul>
                  {TOOL_DEFINITIONS.map((tool) => (
                    <li key={tool.name}>
                      <h3>{tool.name}</h3>

                      <p>{tool.description.split("\n")[0]}</p>
                      {tool.paramsSchema ? (
                        <dl class="params">
                          {Object.entries(tool.paramsSchema).map(
                            ([key, value]) => {
                              return (
                                <>
                                  <dt key={key}>
                                    <code>{key}</code>
                                  </dt>
                                  <dd key={key}>{value.description}</dd>
                                </>
                              );
                            },
                          )}
                        </dl>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section id="resources">
                <h2>Additional Resources</h2>
                <ul>
                  <li>
                    <a href="https://github.com/getsentry/sentry-mcp">
                      sentry-mcp on GitHub
                    </a>
                  </li>
                </ul>
              </section>
            </article>
            <nav>
              <ul>
                <li>
                  <a href="#overview">Overview</a>
                  <ul>
                    <li>
                      <a href="#with-cursor">With Cursor</a>
                    </li>
                    <li>
                      <a href="#with-windsurf">With Windsurf</a>
                    </li>
                    <li>
                      <a href="#with-vscode">With VSCode</a>
                    </li>
                    <li>
                      <a href="#with-zed">With Zed</a>
                    </li>
                  </ul>
                </li>
                <li>
                  <a href="#workflows">Workflows</a>
                </li>
                <li>
                  <a href="#tools">Tools</a>
                </li>
                <li>
                  <a href="#resources">Resources</a>
                </li>
              </ul>
            </nav>
          </main>
        </div>

        <script dangerouslySetInnerHTML={{ __html: copyPasteHelper }} />
      </body>
    </html>,
  );
});
