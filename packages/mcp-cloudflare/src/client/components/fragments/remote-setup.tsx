import { Accordion } from "../ui/accordion";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";
import { Prose } from "../ui/prose";
import { NPM_REMOTE_NAME } from "@/constants";
import { Button } from "../ui/button";

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

  const sentryMCPConfig = {
    url: endpoint,
  };

  // https://code.visualstudio.com/docs/copilot/chat/mcp-servers
  const vsCodeHandler = `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({
      name: mcpServerName,
      serverUrl: endpoint,
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
          <strong>Organization and Project Constraints:</strong> You can
          optionally constrain your MCP session to specific organizations or
          projects by including them in the URL path:
        </p>
        <ul>
          <li>
            <code>{endpoint}/:organization</code> - Restricts session to a
            specific organization
          </li>
          <li>
            <code>{endpoint}/:organization/:project</code> - Restricts session
            to a specific organization and project
          </li>
        </ul>

        <p>
          Sentry's MCP server supports both the SSE and HTTP Streaming
          protocols, and will negotiate based on your client's capabilities. If
          for some reason your client does not handle this well you can pin to
          the SSE-only implementation with the following URL:
        </p>
        <CodeSnippet snippet={sseEndpoint} />

        <h3>Integration Guides</h3>
      </Prose>
      <Accordion type="single" collapsible>
        <SetupGuide id="cursor" title="Cursor">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const deepLink =
                "cursor://anysphere.cursor-deeplink/mcp/install?name=Sentry&config=eyJ1cmwiOiJodHRwczovL21jcC5zZW50cnkuZGV2L21jcCJ9";
              window.location.href = deepLink;
            }}
            className="mt-2 mb-2 bg-violet-300 text-black hover:bg-violet-400 hover:text-black"
          >
            Install in Cursor
          </Button>
          <ol>
            <li>
              Or manually: <strong>Cmd + Shift + J</strong> to open Cursor
              Settings.
            </li>
            <li>
              Select <strong>Tools and Integrations</strong>.
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
                      sentry: sentryMCPConfig,
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
                snippet={`claude mcp add --transport http sentry ${endpoint}`}
              />
            </li>
            <li>
              This will trigger an OAuth authentication flow to connect Claude
              Code to your Sentry account.
            </li>
          </ol>
          <p>
            <small>
              For more details, see the{" "}
              <a href="https://docs.anthropic.com/en/docs/claude-code/mcp">
                Claude Code MCP documentation
              </a>
              .
            </small>
          </p>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.href = vsCodeHandler;
            }}
            className="mt-2 mb-2 bg-violet-300 text-black hover:bg-violet-400 hover:text-black"
          >
            Install in VSCode
          </Button>
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
              Select <strong>HTTP (HTTP or Server-Sent Events)</strong>.
            </li>
            <li>
              Enter the following configuration, and hit enter
              <strong> {endpoint}</strong>
            </li>
            <li>
              Enter the name <strong>Sentry</strong> and hit enter.
            </li>
            <li>Allow the authentication flow to complete.</li>
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
              <CodeSnippet noMargin snippet={zedInstructions} />
            </li>
          </ol>
        </SetupGuide>
      </Accordion>
    </>
  );
}
