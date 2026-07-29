import CodeSnippet from "../../ui/code-snippet";

interface WindsurfInstructionsProps {
  transport: "cloud" | "stdio";
}

export function WindsurfInstructions({ transport }: WindsurfInstructionsProps) {
  if (transport === "cloud") {
    const endpoint = new URL("/mcp", window.location.href).href;
    const coreConfig = {
      serverUrl: endpoint,
    };

    return (
      <>
        <ol>
          <li>
            Open <strong>Settings → Tools → Windsurf Settings</strong>.
          </li>
          <li>
            Under <strong>Model Context Protocol Servers</strong>, select{" "}
            <strong>View Raw Config</strong>.
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
        <p>
          <small>
            For more details, see the{" "}
            <a
              href="https://docs.windsurf.com/plugins/cascade/mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              Windsurf MCP documentation
            </a>
            .
          </small>
        </p>
      </>
    );
  }

  // Stdio transport
  const defaultEnv = {
    SENTRY_ACCESS_TOKEN: "sentry-user-token",
    OPENAI_API_KEY: "your-openai-key",
  } as const;
  const coreConfig = {
    command: "npx",
    args: ["@sentry/mcp-server@latest"],
    env: defaultEnv,
  };

  return (
    <>
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
    </>
  );
}
