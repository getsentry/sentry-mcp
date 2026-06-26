import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process.js";
import type {
  AgentProvider,
  AgentProviderName,
  ProviderHealthResult,
  ProviderPromptResult,
} from "./types.js";

export function parseClaudeMcpGetStatus(output: string): string | null {
  const match = output.match(/^\s*Status:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

export interface CodexMcpListRow {
  name: string;
  status: string;
  auth: string;
  details: string[];
}

export function parseCodexMcpListRow(
  output: string,
  serverName: string,
): CodexMcpListRow | null {
  const line = output
    .split(/\r?\n/)
    .find((item) => item.trimStart().startsWith(`${serverName} `));

  if (!line) {
    return null;
  }

  const columns = line.trim().split(/\s{2,}/);
  if (columns.length < 3) {
    return null;
  }

  const [name, ...rest] = columns;
  const auth = rest.at(-1);
  const status = rest.at(-2);

  if (!auth || !status) {
    return null;
  }

  return {
    name,
    status,
    auth,
    details: rest.slice(0, -2),
  };
}

function summarizeCommandFailure(result: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
  timedOut: boolean;
}): string {
  if (result.timedOut) {
    return "Timed out.";
  }

  if (result.error) {
    return result.error;
  }

  if (result.signal) {
    return `Exited via signal ${result.signal}.`;
  }

  return `Exited with code ${result.exitCode ?? "unknown"}.`;
}

async function createClaudeMcpConfigFile(
  serverName: string,
  cwd: string,
): Promise<string | null> {
  const projectMcpPath = path.join(cwd, ".mcp.json");

  try {
    await access(projectMcpPath);
  } catch {
    return null;
  }

  const raw = await readFile(projectMcpPath, "utf8");
  const parsed = JSON.parse(raw) as {
    mcpServers?: Record<string, unknown>;
  };
  const selectedServer = parsed.mcpServers?.[serverName];

  if (!selectedServer) {
    return null;
  }

  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "claude-mcp-agent-cli-config-"),
  );
  const configPath = path.join(tempDir, "mcp.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          [serverName]: selectedServer,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return configPath;
}

class ClaudeProvider implements AgentProvider {
  readonly name: AgentProviderName = "claude";

  async checkHealth(
    serverName: string,
    cwd: string,
  ): Promise<ProviderHealthResult> {
    const configPath = await createClaudeMcpConfigFile(serverName, cwd);
    const result = await runCommand({
      command: "claude",
      args: [
        ...(configPath
          ? ["--mcp-config", configPath, "--strict-mcp-config"]
          : []),
        "mcp",
        "get",
        serverName,
      ],
      cwd,
      timeoutMs: 30_000,
    });

    const status = parseClaudeMcpGetStatus(result.stdout);
    const passed =
      result.exitCode === 0 &&
      status !== null &&
      !status.toLowerCase().includes("failed");

    return {
      passed,
      summary: status ?? summarizeCommandFailure(result),
      primaryCommand: result,
      metadata: {
        status,
      },
    };
  }

  async runPrompt(input: {
    serverName: string;
    cwd: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<ProviderPromptResult> {
    const configPath = await createClaudeMcpConfigFile(
      input.serverName,
      input.cwd,
    );
    const debugFile = path.join(
      os.tmpdir(),
      `claude-mcp-agent-cli-test-${Date.now()}.log`,
    );
    const command = await runCommand({
      command: "claude",
      args: [
        ...(configPath
          ? ["--mcp-config", configPath, "--strict-mcp-config"]
          : []),
        "--permission-mode",
        "bypassPermissions",
        "--debug-file",
        debugFile,
        "-p",
        input.prompt,
      ],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
    });
    const finalOutput = command.stdout.trim();

    return {
      passed: command.exitCode === 0,
      summary:
        command.exitCode === 0
          ? "Claude prompt completed."
          : summarizeCommandFailure(command),
      command,
      finalOutput,
      scenarioResult: {
        passed: false,
        summary: "Scenario validation was not applied.",
      },
      artifactPath: debugFile,
    };
  }
}

class CodexProvider implements AgentProvider {
  readonly name: AgentProviderName = "codex";

  async checkHealth(
    serverName: string,
    cwd: string,
  ): Promise<ProviderHealthResult> {
    const primaryCommand = await runCommand({
      command: "codex",
      args: ["mcp", "get", serverName],
      cwd,
      timeoutMs: 30_000,
    });
    const secondaryCommand = await runCommand({
      command: "codex",
      args: ["mcp", "list"],
      cwd,
      timeoutMs: 30_000,
    });

    const row = parseCodexMcpListRow(secondaryCommand.stdout, serverName);
    const passed = primaryCommand.exitCode === 0;
    const auth = row?.auth ?? null;
    const status = row?.status ?? null;

    return {
      passed,
      summary:
        row !== null
          ? `Configured (${status ?? "unknown"}, ${auth ?? "unknown auth"}).`
          : summarizeCommandFailure(primaryCommand),
      primaryCommand,
      secondaryCommand,
      metadata: {
        status,
        auth,
      },
    };
  }

  async runPrompt(input: {
    serverName: string;
    cwd: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<ProviderPromptResult> {
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), "codex-mcp-agent-cli-test-"),
    );
    const outputFile = path.join(outputDir, "last-message.txt");

    const command = await runCommand({
      command: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        outputFile,
        input.prompt,
      ],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
    });

    let finalOutput = "";
    try {
      finalOutput = (await readFile(outputFile, "utf8")).trim();
    } catch {
      finalOutput = "";
    }

    return {
      passed: command.exitCode === 0,
      summary:
        command.exitCode === 0
          ? "Codex prompt completed."
          : summarizeCommandFailure(command),
      command,
      finalOutput,
      scenarioResult: {
        passed: false,
        summary: "Scenario validation was not applied.",
      },
      artifactPath: outputFile,
    };
  }
}

export function createProvider(name: AgentProviderName): AgentProvider {
  switch (name) {
    case "claude":
      return new ClaudeProvider();
    case "codex":
      return new CodexProvider();
  }
}
