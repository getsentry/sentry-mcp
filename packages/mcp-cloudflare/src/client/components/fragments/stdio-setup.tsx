import { Accordion } from "../ui/accordion";
import { Link, Paragraph } from "../ui/base";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function RemoteSetup() {
  const mcpStdioSnippet = `npx @sentry/mcp-server`;

  return (
    <>
      <Paragraph>
        The stdio client is made available on npm at{" "}
        <Link href="https://www.npmjs.com/package/@sentry/mcp-server">
          @sentry/mcp-server
        </Link>
        .
      </Paragraph>
      <CodeSnippet snippet={mcpStdioSnippet} />
      <Paragraph>Use the following setup guides to get started.</Paragraph>
      <Accordion type="single" collapsible className="w-full">
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
                        args: ["@sentry/mcp-server"],
                        env: {
                          SENTRY_AUTH_TOKEN: "sentry-pat",
                          SENTRY_HOST: "sentry.io",
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
          </ol>
          <p>
            <small>
              Note: Windsurf requires an enterprise account to utilize MCP. 😕
            </small>
          </p>
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
                      args: ["@sentry/mcp-server"],
                      env: {
                        SENTRY_AUTH_TOKEN: "sentry-pat",
                        SENTRY_HOST: "sentry.io",
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
                        args: ["@sentry/mcp-server"],
                        env: {
                          SENTRY_AUTH_TOKEN: "sentry-pat",
                          SENTRY_HOST: "sentry.io",
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
