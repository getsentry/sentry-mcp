import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import CodeSnippet from "../ui/code-snippet";
import SetupGuide from "./setup-guide";
import { Prose } from "../ui/prose";
import { NPM_REMOTE_NAME } from "@/constants";
import { Button } from "../ui/button";
import { Heading } from "../ui/base";

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
    <>
      <Prose className="mb-6">
        <p>
          If you've got a client that natively supports the current MCP
          specification, including OAuth, you can connect directly.
        </p>
        <CodeSnippet snippet={endpoint} />
        <p>
          <strong>Organization and Project Constraints:</strong> You can
          optionally constrain your MCP session to a specific organization and
          project by including them in the URL path:
        </p>
        <ul>
          <li>
            <code>{endpoint}/:organization</code> — Restricts the session to a
            specific organization
          </li>
          <li>
            <code>{endpoint}/:organization/:project</code> — Restricts the
            session to a specific organization and project
          </li>
        </ul>
        <Accordion type="single" collapsible>
          <AccordionItem value="sse-deprecated">
            <AccordionTrigger>SSE support is deprecated</AccordionTrigger>
            <AccordionContent>
              <p className="mb-2">
                New clients should use HTTP Streaming via the main
                <code>/mcp</code> endpoint. If you must use the SSE-only
                implementation, use the following URL:
              </p>
              <CodeSnippet noMargin snippet={sseEndpoint} />
              <p className="mt-2">
                <strong>Limitations:</strong> SSE endpoints do not support
                organization or project constraints. Use the main
                <code>/mcp</code> endpoint if you need scoped access.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Prose>
      <Heading as="h3">Integration Guides</Heading>
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
            <li>
              Optional: To use the service with <code>cursor-agent</code>:
              <CodeSnippet noMargin snippet={`cursor-agent mcp login sentry`} />
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
            <li>
              You may need to manually authenticate if it doesnt happen
              automatically, which can be doe via <code>/mcp</code>.
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

        <SetupGuide id="codex-cli" title="Codex">
          <ol>
            <li>Open your terminal to access the CLI.</li>
            <li>
              <CodeSnippet
                noMargin
                snippet={`codex mcp add sentry -- ${coreConfig.command} ${coreConfig.args.join(" ")}`}
              />
            </li>
            <li>
              Next time you run <code>codex</code>, the Sentry MCP server will
              be available. It will automatically open the OAuth flow to connect
              to your Sentry account.
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
              Next time you run <code>codex</code>, the Sentry MCP server will
              be available. It will automatically open the OAuth flow to connect
              to your Sentry account.
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
