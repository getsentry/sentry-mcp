import CodeSnippet from "../ui/code-snippet";
import { Prose } from "../ui/prose";
import { NPM_REMOTE_NAME } from "@/constants";
import { Button } from "../ui/button";
import InstallTabs, { Tab } from "./install-tabs";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function RemoteSetup() {
  const endpoint = new URL("/mcp", window.location.href).href;
  return (
    <>
      <Prose className="mb-6">
        <p>Connect directly using the base endpoint:</p>
        <div className="bg-background-3 p-1 mb-6">
          <CodeSnippet noMargin snippet={endpoint} />
        </div>
        <p>
          <strong>Path Constraints:</strong> Restrict the session to a specific
          organization or project by adding them to the URL path. This ensures
          all skills operate within the specified scope.
        </p>
        <ul>
          <li>
            <code>/:organization</code> — Limit to one organization
          </li>
          <li>
            <code>/:organization/:project</code> — Limit to a specific project
          </li>
        </ul>
        <p>
          <strong>Agent Mode:</strong> Reduce context by exposing a single{" "}
          <code>use_sentry</code> tool instead of individual skills. The
          embedded AI agent handles natural language requests and automatically
          chains tool calls as needed. Note: Agent mode approximately doubles
          response time due to the embedded AI layer.
        </p>
        <ul>
          <li>
            <code>?agent=1</code> — Enable agent mode (works with path
            constraints)
          </li>
        </ul>
      </Prose>
    </>
  );
}

export function RemoteSetupTabs() {
  const endpoint = new URL("/mcp", window.location.href).href;

  const mcpRemoteSnippet = `npx ${NPM_REMOTE_NAME}@latest ${endpoint}`;
  // the shared configuration for all clients
  const coreConfig = {
    command: "npx",
    args: ["-y", `${NPM_REMOTE_NAME}@latest`, endpoint],
  };

  const codexRemoteConfigToml = [
    "[mcp_servers.sentry]",
    'command = "npx"',
    `args = ["-y", "${NPM_REMOTE_NAME}@latest", "${endpoint}"]`,
  ].join("\n");

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
    <InstallTabs className="w-fit max-w-full sticky top-28">
      <Tab id="cursor" title="Cursor">
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
            Or manually:{" "}
            <strong>
              <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                ⌘
              </div>{" "}
              +{" "}
              <div className="h-8 pl-1.5 pr-2 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                Shift
              </div>{" "}
              +{" "}
              <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                J
              </div>
            </strong>{" "}
            to open Cursor Settings.
          </li>
          <li>
            Select <strong>Skills and Integrations</strong>.
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
          <li>
            Optional: To use the service with <code>cursor-agent</code>:
            <CodeSnippet noMargin snippet={`cursor-agent mcp login sentry`} />
          </li>
        </ol>
      </Tab>

      <Tab id="claude-code" title="Claude Code">
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
          <li>
            You may need to manually authenticate if it doesnt happen
            automatically, which can be done via <code>/mcp</code>.
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
      </Tab>

      <Tab id="codex-cli" title="Codex">
        <ol>
          <li>Open your terminal to access the CLI.</li>
          <li>
            <CodeSnippet
              noMargin
              snippet={`codex mcp add sentry -- ${
                coreConfig.command
              } ${coreConfig.args.join(" ")}`}
            />
          </li>
          <li>
            Next time you run <code>codex</code>, the Sentry MCP server will be
            available. It will automatically open the OAuth flow to connect to
            your Sentry account.
          </li>
        </ol>
        Or
        <ol>
          <li>
            Edit <code>~/.codex/config.toml</code> and add the remote MCP
            configuration:
            <CodeSnippet noMargin snippet={codexRemoteConfigToml} />
          </li>
          <li>
            Save the file and restart any running <code>codex</code> session
          </li>
          <li>
            Next time you run <code>codex</code>, the Sentry MCP server will be
            available. It will automatically open the OAuth flow to connect to
            your Sentry account.
          </li>
        </ol>
      </Tab>

      <Tab id="windsurf" title="Windsurf">
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
      </Tab>

      <Tab id="vscode" title="Visual Studio Code">
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
            <strong>
              {" "}
              <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                ⌘
              </div>{" "}
              +{" "}
              <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                P
              </div>
            </strong>{" "}
            and search for <strong>MCP: Add Server</strong>.
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
      </Tab>

      <Tab id="warp" title="Warp">
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
                    env: {},
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
      </Tab>

      <Tab id="zed" title="Zed">
        <ol>
          <li>
            <strong>
              <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                ⌘
              </div>{" "}
              +{" "}
              <div className="size-8 [box-shadow:0_4px_0_0_#695f89] duration-300 hover:translate-y-1 hover:[box-shadow:0_0px_0_0_#695f89] inline-grid place-items-center rounded-lg border border-white/10 bg-background-3">
                ,
              </div>
            </strong>{" "}
            to open Zed settings.
          </li>
          <li>
            <CodeSnippet noMargin snippet={zedInstructions} />
          </li>
        </ol>
      </Tab>
    </InstallTabs>
  );
}
