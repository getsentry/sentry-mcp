import { Accordion } from "../ui/accordion";
import { Heading, Link } from "../ui/base";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";
import { NPM_PACKAGE_NAME, SCOPES } from "../../../constants";
import { Prose } from "../ui/prose";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function StdioSetup() {
  const mcpStdioSnippet = `npx ${NPM_PACKAGE_NAME}@latest`;

  const coreConfig = {
    command: "npx",
    args: ["@sentry/mcp-server@latest"],
    env: {
      SENTRY_ACCESS_TOKEN: "sentry-user-token",
      SENTRY_HOST: "sentry.io",
      OPENAI_API_KEY: "your-openai-key", // Required for AI-powered search tools
    },
  };

  const codexConfigToml = [
    "[mcp_servers.sentry]",
    'command = "npx"',
    'args = ["@sentry/mcp-server@latest"]',
    'env = { SENTRY_ACCESS_TOKEN = "sentry-user-token", SENTRY_HOST = "sentry.io", OPENAI_API_KEY = "your-openai-key" }',
  ].join("\n");

  return (
    <>
      <Prose className="mb-6">
        <p>
          The stdio client is made available on npm at{" "}
          <Link href={`https://www.npmjs.com/package/${NPM_PACKAGE_NAME}`}>
            {NPM_PACKAGE_NAME}
          </Link>
          .
        </p>
        <p>
          <strong>Note:</strong> The MCP is developed against the cloud service
          of Sentry. If you are self-hosting Sentry you may find some tool calls
          are either using outdated APIs, or otherwise using APIs not available
          in self-hosted.
        </p>

        <p>
          Create a User Auth Token in your account settings with the following
          scopes:
        </p>
        <ul>
          {Object.entries(SCOPES).map(([scope, description]) => (
            <li key={scope}>
              <strong>{scope}</strong> - {description}
            </li>
          ))}
        </ul>
        <p>
          You'll then bind that to your MCP instance using the following
          command:
        </p>
        <CodeSnippet
          snippet={[
            `${mcpStdioSnippet}`,
            "--access-token=sentry-user-token",
            "--host=sentry.io",
          ].join(" \\\n  ")}
        />
        <p>
          <strong>Note:</strong> We enable Sentry reporting by default (to
          sentry.io). If you wish to disable it, pass <code>--sentry-dsn=</code>{" "}
          with an empty value.
        </p>

        <p>
          <strong>Constraints (stdio only):</strong> Restrict all tool calls to
          a specific organization, and optionally to a project within that
          organization using CLI flags.
        </p>
        <CodeSnippet
          snippet={[
            `${mcpStdioSnippet}`,
            "--access-token=sentry-user-token",
            "--host=sentry.io",
            "--organization-slug=sentry",
            "--project-slug=mcp-server",
          ].join(" \\\n  ")}
        />
        <p>
          You can provide just <code>--organization-slug</code> to scope to an
          org, or include <code>--project-slug</code> to scope to a single
          project within that org.
        </p>

        <p>
          <strong>Scopes:</strong> The default configuration grants read-only
          access (listed above). To grant full access to all available tools use
          <code>--all-scopes</code>.
        </p>
        <CodeSnippet
          snippet={[
            `${mcpStdioSnippet}`,
            "--access-token=sentry-user-token",
            "--host=sentry.io",
            "--all-scopes",
          ].join(" \\\n  ")}
        />
        <p>
          For more options and details, run{" "}
          <code>npx @sentry/mcp-server@latest --help</code> — there are many
          flags available.
        </p>
      </Prose>
      <Heading as="h3">Integration Guides</Heading>
      <Accordion type="single" collapsible>
        <SetupGuide id="cursor" title="Cursor">
          <ol>
            <li>
              Or manually: <strong>Cmd + Shift + J</strong> to open Cursor
              Settings.
            </li>
            <li>
              Select <strong>MCP Tools</strong>.
            </li>
            <li>
              Select <strong>New MCP Server</strong>.
            </li>
            <li>
              <CodeSnippet
                noMargin
                snippet={JSON.stringify(
                  {
                    mcpServers: {
                      sentry: {
                        ...coreConfig,
                        env: {
                          ...coreConfig.env,
                        },
                      },
                    },
                  },
                  undefined,
                  2,
                )}
              />
            </li>
          </ol>
        </SetupGuide>

        <SetupGuide id="claude-code" title="Claude Code">
          <ol>
            <li>Open your terminal to access the CLI.</li>
            <li>
              <CodeSnippet
                noMargin
                snippet={`claude mcp add sentry -e SENTRY_ACCESS_TOKEN=sentry-user-token -e SENTRY_HOST=sentry.io -e OPENAI_API_KEY=your-openai-key -- ${mcpStdioSnippet}`}
              />
            </li>
            <li>
              Replace <code>sentry-user-token</code> with your actual User Auth
              Token and, if using self-hosted Sentry, replace{" "}
              <code>sentry.io</code> with your Sentry host.
            </li>
          </ol>
          <p>
            <small>
              For more details, see the{" "}
              <Link href="https://docs.anthropic.com/en/docs/claude-code/mcp">
                Claude Code MCP documentation
              </Link>
              .
            </small>
          </p>
        </SetupGuide>

        <SetupGuide id="codex-cli" title="Codex">
          <ol>
            <li>
              Edit <code>~/.codex/config.toml</code> and add the MCP server
              configuration:
              <CodeSnippet noMargin snippet={codexConfigToml} />
            </li>
            <li>
              Replace <code>sentry-user-token</code> with your Sentry User Auth
              Token. Update <code>SENTRY_HOST</code> if you are using a
              self-hosted deployment.
            </li>
            <li>
              Restart any running <code>codex</code> session to load the new MCP
              configuration.
            </li>
          </ol>
        </SetupGuide>

        <SetupGuide id="windsurf" title="Windsurf">
          <ol>
            <li>Open Windsurf Settings.</li>
            <li>
              Under <strong>Cascade</strong>, you'll find{" "}
              <strong>Model Context Protocol Servers</strong>.
            </li>
            <li>
              Select <strong>Add Server</strong>.
            </li>
            <li>
              <CodeSnippet
                noMargin
                snippet={JSON.stringify(
                  {
                    mcpServers: {
                      sentry: {
                        ...coreConfig,
                        env: {
                          ...coreConfig.env,
                        },
                      },
                    },
                  },
                  undefined,
                  2,
                )}
              />
            </li>
          </ol>
        </SetupGuide>

        <SetupGuide id="vscode" title="Visual Studio Code">
          <ol>
            <li>
              <strong>CMD + P</strong> and search for{" "}
              <strong>MCP: Add Server</strong>.
            </li>
            <li>
              Select <strong>Command (stdio)</strong>
            </li>
            <li>
              Enter the following configuration, and hit enter.
              <CodeSnippet noMargin snippet={mcpStdioSnippet} />
            </li>
            <li>
              Enter the name <strong>Sentry</strong> and hit enter.
            </li>
            <li>
              Update the server configuration to include your configuration:
              <CodeSnippet
                noMargin
                snippet={JSON.stringify(
                  {
                    [mcpServerName]: {
                      type: "stdio",
                      ...coreConfig,
                      env: {
                        ...coreConfig.env,
                      },
                    },
                  },
                  undefined,
                  2,
                )}
              />
            </li>
            <li>
              Activate the server using <strong>MCP: List Servers</strong> and
              selecting <strong>Sentry</strong>, and selecting{" "}
              <strong>Start Server</strong>.
            </li>
          </ol>
          <p>
            <small>Note: MCP is supported in VSCode 1.99 and above.</small>
          </p>
        </SetupGuide>

        <SetupGuide id="warp" title="Warp">
          <ol>
            <li>
              Open{" "}
              <a
                href="https://warp.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                Warp
              </a>{" "}
              and navigate to MCP server settings using one of these methods:
              <ul>
                <li>
                  From Warp Drive: <strong>Personal → MCP Servers</strong>
                </li>
                <li>
                  From Command Palette: search for{" "}
                  <strong>Open MCP Servers</strong>
                </li>
                <li>
                  From Settings:{" "}
                  <strong>Settings → AI → Manage MCP servers</strong>
                </li>
              </ul>
            </li>
            <li>
              Click <strong>+ Add</strong> button.
            </li>
            <li>
              Select <strong>CLI Server (Command)</strong> option.
            </li>
            <li>
              <CodeSnippet
                noMargin
                snippet={JSON.stringify(
                  {
                    Sentry: {
                      ...coreConfig,
                      env: {
                        ...coreConfig.env,
                      },
                      working_directory: null,
                    },
                  },
                  undefined,
                  2,
                )}
              />
            </li>
          </ol>
          <p>
            <small>
              For more details, see the{" "}
              <a
                href="https://docs.warp.dev/knowledge-and-collaboration/mcp"
                target="_blank"
                rel="noopener noreferrer"
              >
                Warp MCP documentation
              </a>
              .
            </small>
          </p>
        </SetupGuide>

        <SetupGuide id="zed" title="Zed">
          <ol>
            <li>
              <strong>CMD + ,</strong> to open Zed settings.
            </li>
            <li>
              <CodeSnippet
                noMargin
                snippet={JSON.stringify(
                  {
                    context_servers: {
                      [mcpServerName]: {
                        ...coreConfig,
                        env: {
                          ...coreConfig.env,
                        },
                      },
                      settings: {},
                    },
                  },
                  undefined,
                  2,
                )}
              />
            </li>
          </ol>
        </SetupGuide>
      </Accordion>
    </>
  );
}
