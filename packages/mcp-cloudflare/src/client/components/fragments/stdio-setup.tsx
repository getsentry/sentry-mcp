import { Link } from "../ui/base";
import CodeSnippet from "../ui/code-snippet";
// import SetupGuide from "./setup-guide";
import skillDefinitions from "@sentry/mcp-server/skillDefinitions";
import { NPM_PACKAGE_NAME, SCOPES } from "../../../constants";
import { Prose } from "../ui/prose";
import InstallTabs, { Tab } from "./install-tabs";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";
const orderedSkills = [...skillDefinitions].sort((a, b) => a.order - b.order);

export default function StdioSetup() {
  const mcpStdioSnippet = `npx ${NPM_PACKAGE_NAME}@latest`;

  const selfHostedHostExample = [
    `${mcpStdioSnippet}`,
    "--access-token=sentry-user-token",
    "--host=sentry.example.com",
  ].join(" \\\n  ");

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
        <p>
          <strong>AI-powered search:</strong> If you want the
          <code>search_events</code> and <code>search_issues</code> tools to
          translate natural language queries, add an
          <code>OPENAI_API_KEY</code> next to your Sentry token. The rest of the
          MCP server works without it, so you can skip this step if you do not
          need those tools.
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

              <dt className="font-medium text-slate-100">
                <code>OPENAI_API_KEY</code>
              </dt>
              <dd className="text-slate-300">
                Optional for the standard tools, but required for the AI-powered
                search tools (<code>search_events</code> /
                <code>search_issues</code>). When unset, those tools stay hidden
                but everything else works as usual.
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
            <p className="mt-3 text-slate-400">
              Use <code>--skills</code> (or <code>MCP_SKILLS</code>) to pick the
              tool bundles you want to expose. Separate skill ids with commas.
            </p>
            <dl className="mt-3 space-y-2">
              <dt className="font-medium text-slate-100">
                <code>--skills</code> / <code>MCP_SKILLS</code>
              </dt>
              <dd className="text-slate-300">
                Skills automatically grant the minimum scopes required by the
                selected tools. You can combine any of the following ids:
                <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-400">
                  {orderedSkills.map((skill) => (
                    <li key={skill.id}>
                      <code>{skill.id}</code> – {skill.name}
                      {skill.defaultEnabled ? " (default)" : ""}
                      {skill.description ? `: ${skill.description}` : ""}
                    </li>
                  ))}
                </ul>
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
    </>
  );
}

export function StdioSetupTabs() {
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
  const selfHostedEnvLine =
    'env = { SENTRY_ACCESS_TOKEN = "sentry-user-token", SENTRY_HOST = "sentry.example.com", OPENAI_API_KEY = "your-openai-key" }';
  return (
    <InstallTabs className="w-fit max-w-full sticky top-28">
      <Tab
        id="cursor"
        title="Cursor"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            version="1.1"
            className="size-4"
            viewBox="0 0 466.73 532.09"
            aria-hidden="true"
          >
            <path
              className="fill-current"
              d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75,3.32,9.3,9.46,9.3,16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"
            />
          </svg>
        }
      >
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
                2
              )}
            />
          </li>
        </ol>
      </Tab>

      <Tab
        id="claude-code"
        title="Claude Code"
        icon={
          <svg
            role="img"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            className="fill-current"
          >
            <title>Claude</title>
            <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
          </svg>
        }
      >
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
      </Tab>

      <Tab id="codex-cli" title="Codex">
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
                    sentry: {
                      ...coreConfig,
                      env: {
                        ...coreConfig.env,
                      },
                    },
                  },
                },
                undefined,
                2
              )}
            />
          </li>
        </ol>
      </Tab>

      <Tab id="vscode" title="Visual Studio Code">
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
                2
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
                    env: {
                      ...coreConfig.env,
                    },
                    working_directory: null,
                  },
                },
                undefined,
                2
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
                2
              )}
            />
          </li>
        </ol>
      </Tab>
    </InstallTabs>
  );
}
