import { Fragment } from "react/jsx-runtime";
import { TOOL_DEFINITIONS } from "@sentry/mcp-server/toolDefinitions";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function App() {
  const sseUrl = new URL("/sse", window.location.href).href;
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        [mcpServerName]: {
          command: "npx",
          args: ["-y", "mcp-remote", sseUrl],
        },
      },
    },
    undefined,
    2,
  );
  // https://code.visualstudio.com/docs/copilot/chat/mcp-servers
  const vsCodeHandler = `code:mcp/install?${encodeURIComponent(
    JSON.stringify({
      name: mcpServerName,
      command: "npx",
      args: ["-y", "mcp-remote", sseUrl],
    }),
  )}`;
  const zedInstructions = JSON.stringify(
    {
      context_servers: {
        [mcpServerName]: {
          command: "npx",
          args: ["-y", "mcp-remote", sseUrl],
        },
        settings: {},
      },
    },
    undefined,
    2,
  );

  return (
    <div className="container sm:p-8 p-4">
      <header className="prose">
        <h1>Sentry MCP</h1>
      </header>
      <main className="flex gap-4 max-w-4xl">
        <article className="prose">
          <div id="top" />
          <p>
            This service provides a Model Context Provider for interacting with{" "}
            <a href="https://docs.sentry.io/api/">Sentry's API</a>.
          </p>
          <p>
            While this service is maintained by Sentry, it is very much still a
            proof-of-concept as the protocol is still in development (as is our
            own thinking around its usage).
          </p>
          <div className="snippet">
            <button
              type="button"
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(mcpSnippet);
              }}
            >
              Copy Configuration
            </button>
            <pre>{mcpSnippet}</pre>
          </div>
          <p>
            Or if you just need the server itself (requires an OAuth compatible
            client):
          </p>
          <div className="snippet">
            <button
              type="button"
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(sseUrl);
              }}
            >
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
                Note: Windsurf requires an enterprise account to utilize MCP. 😕
              </small>
            </p>
          </section>

          <section className="setup-guide">
            <h3 id="with-vscode">With VSCode</h3>
            <ol>
              <li>
                <a href={vsCodeHandler}>Install the MCP extension</a>
              </li>
            </ol>
            <p>
              <small>Note: MCP is supported in VSCode 1.99 and above.</small>
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
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(zedInstructions);
                    }}
                  >
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
              Here's a few sample workflows (prompts) that we've tried to design
              around within the provider:
            </p>
            <ul>
              <li>
                <blockquote>
                  Check Sentry for errors in <code>@file.tsx</code> and propose
                  solutions.
                </blockquote>
              </li>
              <li>
                <blockquote>
                  Diagnose issue <code>ISSUE_URL</code> in Sentry and propose
                  solutions.
                </blockquote>
              </li>
              <li>
                <blockquote>
                  Create a new project in Sentry for <code>service-name</code>{" "}
                  and setup local instrumentation using it.
                </blockquote>
              </li>
            </ul>
          </section>

          <section className="tools" id="tools">
            <h2>Available Tools</h2>
            <p>
              <small>
                Note: Any tool that takes an <code>organization_slug</code>{" "}
                parameter will try to infer a default organization, otherwise
                you should mention it in the prompt.
              </small>
            </p>
            <ul>
              {TOOL_DEFINITIONS.map((tool) => (
                <li key={tool.name}>
                  <h3>{tool.name}</h3>
                  <p>{tool.description.split("\n")[0]}</p>
                  {tool.paramsSchema ? (
                    <dl className="params">
                      {Object.entries(tool.paramsSchema).map(([key, value]) => {
                        return (
                          <Fragment key={key}>
                            <dt>
                              <code>{key}</code>
                            </dt>
                            <dd>{value.description}</dd>
                          </Fragment>
                        );
                      })}
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
        <nav className="sm:block hidden max-w-[200px] prose">
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
  );
}
