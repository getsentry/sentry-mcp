import { Accordion } from "../ui/accordion";
import { Heading, Link } from "../ui/base";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";
import { NPM_PACKAGE_NAME, SCOPES } from "../../../constants";
import { Prose } from "../ui/prose";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function StdioSetup() {
  const mcpStdioSnippet = `npx ${NPM_PACKAGE_NAME}@latest`;

  const defaultEnv = {
    SENTRY_ACCESS_TOKEN: "sentry-user-token",
    OPENAI_API_KEY: "your-openai-key", // Required for AI-powered search tools
  } as const;

  const coreConfig = {
    command: "npx",
    args: ["@sentry/mcp-server@latest"],
    env: defaultEnv,
  };

  const codexConfigToml = [
    "[mcp_servers.sentry]",
    'command = "npx"',
    'args = ["@sentry/mcp-server@latest"]',
    'env = { SENTRY_ACCESS_TOKEN = "sentry-user-token", OPENAI_API_KEY = "your-openai-key" }',
  ].join("\n");

  const selfHostedHostExample = [
    `${mcpStdioSnippet}`,
    "--access-token=sentry-user-token",
    "--host=sentry.example.com",
  ].join(" \\\n  ");

  const selfHostedEnvLine =
    'env = { SENTRY_ACCESS_TOKEN = "sentry-user-token", SENTRY_HOST = "sentry.example.com", OPENAI_API_KEY = "your-openai-key" }';

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
          The CLI targets Sentry's hosted service by default. Add host overrides
          only when you run self-hosted Sentry.
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
        <p>Now wire up that token to the MCP configuration:</p>
        <CodeSnippet
          snippet={[
            `${mcpStdioSnippet}`,
            "--access-token=sentry-user-token",
          ].join(" \\\n  ")}
        />
        <div className="mt-6">
          <h4 className="text-base font-semibold text-slate-100">
            Using with Self-Hosted Sentry
          </h4>
          <p>
            You'll need to provide the hostname of your self-hosted Sentry
            instance:
          </p>
          <CodeSnippet snippet={selfHostedHostExample} />
        </div>

        <h4 className="mb-6 text-lg font-semibold text-slate-100">
          Configuration
        </h4>

        <div className="mt-6 space-y-6 text-sm text-slate-200">
          <section>
            <h5 className="font-semibold uppercase tracking-wide text-slate-300 text-xs">
              Core setup
            </h5>
            <dl className="mt-3 space-y-2">
              <dt className="font-medium text-slate-100">
                <code>--access-token</code> / <code>SENTRY_ACCESS_TOKEN</code>
              </dt>
              <dd className="text-slate-300">Required user auth token.</dd>

              <dt className="font-medium text-slate-100">
                <code>--host</code> / <code>SENTRY_HOST</code>
              </dt>
              <dd className="text-slate-300">
                Hostname override when you run self-hosted Sentry.
              </dd>

              <dt className="font-medium text-slate-100">
                <code>--sentry-dsn</code> / <code>SENTRY_DSN</code>
              </dt>
              <dd className="text-slate-300">
                Send telemetry elsewhere or disable it by passing an empty
                value.
              </dd>
            </dl>
          </section>

          <section>
            <h5 className="font-semibold uppercase tracking-wide text-slate-300 text-xs">
              Constraints
            </h5>
            <dl className="mt-3 space-y-2">
              <dt className="font-medium text-slate-100">
                <code>--organization-slug</code>
              </dt>
              <dd className="text-slate-300">
                Scope all tools to a single organization (CLI only).
              </dd>

              <dt className="font-medium text-slate-100">
                <code>--project-slug</code>
              </dt>
              <dd className="text-slate-300">
                Scope all tools to a specific project within that organization
                (CLI only).
              </dd>
            </dl>
          </section>

          <section>
            <h5 className="font-semibold uppercase tracking-wide text-slate-300 text-xs">
              Permissions
            </h5>
            <dl className="mt-3 space-y-2">
              <dt className="font-medium text-slate-100">
                <code>--all-scopes</code>
              </dt>
              <dd className="text-slate-300">
                Expand the token to the full permission set for every tool.
              </dd>

              <dt className="font-medium text-slate-100">
                <code>--scopes</code> / <code>MCP_SCOPES</code>
              </dt>
              <dd className="text-slate-300">
                Replace the default read-only scopes with an explicit list.
              </dd>

              <dt className="font-medium text-slate-100">
                <code>--add-scopes</code> / <code>MCP_ADD_SCOPES</code>
              </dt>
              <dd className="text-slate-300">
                Keep the read-only defaults and layer on additional scopes.
              </dd>
            </dl>
          </section>
        </div>
        <p className="mt-4 text-sm text-slate-300">
          Need something else? Run{" "}
          <code>npx @sentry/mcp-server@latest --help</code> to view the full
          flag list.
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
                snippet={`claude mcp add sentry -e SENTRY_ACCESS_TOKEN=sentry-user-token -e OPENAI_API_KEY=your-openai-key -- ${mcpStdioSnippet}`}
              />
            </li>
            <li>
              Replace <code>sentry-user-token</code> with your actual User Auth
              Token.
            </li>
            <li>
              Connecting to self-hosted Sentry? Append
              <code>-e SENTRY_HOST=your-hostname</code>.
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
              Token. Add <code>SENTRY_HOST</code> if you run self-hosted Sentry.
              <CodeSnippet noMargin snippet={selfHostedEnvLine} />
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

      <Heading as="h3">Troubleshooting Connectivity</Heading>
      <Prose>
        <p>
          <strong>Having trouble connecting via the stdio client?</strong>
          Start with these checks:
        </p>
        <ul>
          <li>
            <strong>401/403 errors:</strong> Verify your User Auth Token still
            exists and includes the required scopes. Reissue the token if it was
            rotated or downgraded.
          </li>
          <li>
            <strong>404s for organizations or issues:</strong> Confirm the
            <code>--organization-slug</code> / <code>--project-slug</code>
            values and make sure the host matches your self-hosted Sentry
            endpoint (e.g. <code>--host=sentry.example.com</code>).
          </li>
          <li>
            <strong>TLS or network failures:</strong> Ensure you are using HTTPS
            endpoints and that firewalls allow outbound traffic to your Sentry
            instance.
          </li>
        </ul>
      </Prose>
    </>
  );
}
