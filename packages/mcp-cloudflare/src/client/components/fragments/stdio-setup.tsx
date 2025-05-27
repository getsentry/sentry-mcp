import { Accordion } from "../ui/accordion";
import { Link } from "../ui/base";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";
import { SCOPES } from "../../../constants";
import { Prose } from "../ui/prose";
import Note from "../ui/note";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function RemoteSetup() {
  const mcpStdioSnippet = `npx @sentry/mcp-server@latest`;

  const defaultEnv = {
    SENTRY_ACCESS_TOKEN: "sentry-user-token",
    SENTRY_HOST: "sentry.io",
  };

  return (
    <>
      <Prose>
        <p>
          The stdio client is made available on npm at{" "}
          <Link href="https://www.npmjs.com/package/@sentry/mcp-server">
            @sentry/mcp-server
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
        <h3>Integration Guides</h3>
      </Prose>
      <Accordion type="single" collapsible className="max-w-full">
        <SetupGuide id="cursor" title="Cursor">
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
            <li>
              <CodeSnippet
                snippet={JSON.stringify(
                  {
                    mcpServers: {
                      sentry: {
                        command: "npx",
                        args: ["@sentry/mcp-server@latest"],
                        env: defaultEnv,
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

        <SetupGuide id="windsurf" title="Windsurf">
          <ol>
            <li>Open Windsurf Settings.</li>
            <li>
              Under <strong>Cascade</strong>, you'll find{" "}
              <strong>Model Context Provider Servers</strong>.
            </li>
            <li>
              Select <strong>Add Server</strong>.
            </li>
            <li>
              <CodeSnippet
                snippet={JSON.stringify(
                  {
                    mcpServers: {
                      sentry: {
                        command: "npx",
                        args: ["@sentry/mcp-server@latest"],
                        env: defaultEnv,
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
              <CodeSnippet snippet={mcpStdioSnippet} />
            </li>
            <li>
              Enter the name <strong>Sentry</strong> and hit enter.
            </li>
            <li>
              Update the server configuration to include your configuration:
              <CodeSnippet
                snippet={JSON.stringify(
                  {
                    [mcpServerName]: {
                      type: "stdio",
                      command: "npx",
                      args: ["@sentry/mcp-server@latest"],
                      env: defaultEnv,
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

        <SetupGuide id="zed" title="Zed">
          <ol>
            <li>
              <strong>CMD + ,</strong> to open Zed settings.
            </li>
            <li>
              <CodeSnippet
                snippet={JSON.stringify(
                  {
                    context_servers: {
                      [mcpServerName]: {
                        command: "npx",
                        args: ["@sentry/mcp-server@latest"],
                        env: defaultEnv,
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
