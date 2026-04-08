import { spawn } from "node:child_process";
import path from "node:path";
import { getFixtureProjectDir, getStdioFixtureAuthCachePath } from "./setup.js";

const subcommand = process.argv[2];
const allowedSubcommands = new Set(["login", "status", "logout"]);

if (!subcommand || !allowedSubcommands.has(subcommand)) {
  console.error("Usage: sentry-agent-cli-stdio-auth <login|status|logout>");
  process.exit(1);
}

const stdioProjectDir = getFixtureProjectDir("stdio");
const mcpServerPath = path.resolve(
  stdioProjectDir,
  "../../../mcp-server/dist/index.js",
);

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
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
