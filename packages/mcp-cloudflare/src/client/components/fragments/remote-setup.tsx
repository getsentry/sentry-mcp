import { Paragraph } from "../ui/base";
import { Accordion } from "../ui/accordion";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function RemoteSetup() {
  const sseUrl = new URL("/sse", window.location.href).href;

  const mcpRemoteSnippet = `npx mcp-remote ${sseUrl}`;

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
    <>
      <Paragraph>
        If you've got a client that natively supports the current MCP
        specification, including OAuth, you can connect directly.
      </Paragraph>
      <CodeSnippet snippet={sseUrl} />
      <Paragraph>
        Otherwise, you can use the following setup guides to get started.
      </Paragraph>
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
                        args: ["-y", "mcp-remote", sseUrl],
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
              <a href={vsCodeHandler}>Install the MCP extension</a>
            </li>
          </ol>
          <p>
            If this doesn't work, you can manually add the server using the
            following steps:
          </p>
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
              <CodeSnippet snippet={mcpRemoteSnippet} />
            </li>
            <li>
              Enter the name <strong>Sentry</strong> and hit enter.
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
              <CodeSnippet snippet={zedInstructions} />
            </li>
          </ol>
        </SetupGuide>
      </Accordion>
    </>
  );
}
