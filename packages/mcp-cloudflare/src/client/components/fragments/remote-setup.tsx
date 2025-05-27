import { Accordion } from "../ui/accordion";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";
import { Prose } from "../ui/prose";
import { NPM_REMOTE_NAME } from "@/constants";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function RemoteSetup() {
  const endpoint = new URL("/mcp", window.location.href).href;
  const sseEndpoint = new URL("/sse", window.location.href).href;

  const mcpRemoteSnippet = `npx ${NPM_REMOTE_NAME}@latest ${endpoint}`;
  // the shared configuration for all clients
  const coreConfig = {
    command: "npx",
    args: ["-y", `${NPM_REMOTE_NAME}@latest`, endpoint],
  };

  // https://code.visualstudio.com/docs/copilot/chat/mcp-servers
  const vsCodeHandler = `code:mcp/install?${encodeURIComponent(
    JSON.stringify({
      name: mcpServerName,
      command: "npx",
      args: ["-y", `${NPM_REMOTE_NAME}@latest`, endpoint],
    }),
  )}`;
  const zedInstructions = JSON.stringify(
    {
      context_servers: {
        [mcpServerName]: coreConfig,
        settings: {},
      },
    },
    undefined,
    2,
  );

  return (
    <>
      <Prose>
        <p>
          If you've got a client that natively supports the current MCP
          specification, including OAuth, you can connect directly.
        </p>
        <CodeSnippet snippet={endpoint} />
        <p>
          Sentry's MCP server supports both the SSE and HTTP Streaming
          protocols, and will negotiate based on your client's capabilities. If
          for some reason your client does not handle this well you can pin to
          the SSE-only implementation with the following URL:
        </p>
        <CodeSnippet snippet={sseEndpoint} />
        <h3>Integration Guides</h3>
      </Prose>
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
                      sentry: coreConfig,
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
                      sentry: coreConfig,
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
              Select <strong>Command (stdio)</strong>.
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
