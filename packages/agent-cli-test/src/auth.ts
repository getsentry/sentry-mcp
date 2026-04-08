import { spawn } from "node:child_process";
import path from "node:path";
import { getFixtureProjectDir, getStdioFixtureAuthCachePath } from "./setup.js";

export const STDIO_AUTH_SUBCOMMANDS = ["login", "status", "logout"] as const;

export type StdioAuthSubcommand = (typeof STDIO_AUTH_SUBCOMMANDS)[number];

export function isStdioAuthSubcommand(
  value: string | undefined,
): value is StdioAuthSubcommand {
  return (
    value !== undefined &&
    STDIO_AUTH_SUBCOMMANDS.includes(value as StdioAuthSubcommand)
  );
}

export async function runStdioAuthCommand(
  subcommand: StdioAuthSubcommand,
): Promise<number> {
  const stdioProjectDir = getFixtureProjectDir("stdio");
  const mcpServerPath = path.resolve(
    stdioProjectDir,
    "../../../mcp-server/dist/index.js",
  );

  return await new Promise((resolve, reject) => {
    const child = spawn("node", [mcpServerPath, "auth", subcommand], {
      cwd: stdioProjectDir,
      env: {
        ...process.env,
        SENTRY_MCP_AUTH_CACHE: getStdioFixtureAuthCachePath(),
      },
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      resolve(code ?? 1);
    });
  });
}
