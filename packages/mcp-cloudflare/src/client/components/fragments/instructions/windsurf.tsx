import CodeSnippet from "../../ui/code-snippet";
import { NPM_REMOTE_NAME } from "../../../../constants";

interface WindsurfInstructionsProps {
  transport: "cloud" | "stdio";
}

export function WindsurfInstructions({ transport }: WindsurfInstructionsProps) {
  if (transport === "cloud") {
    const endpoint = new URL("/mcp", window.location.href).href;
    const coreConfig = {
      command: "npx",
      args: ["-y", `${NPM_REMOTE_NAME}@latest`, endpoint],
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
                    sentry: coreConfig,
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
