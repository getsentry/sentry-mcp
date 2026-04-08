import { Command } from "commander";
import { createProvider } from "./providers.js";
import { SCENARIOS } from "./scenarios.js";
import { resolveHarnessSetup, type HarnessSetupName } from "./setup.js";
import type {
  AgentCliTestResult,
  AgentProviderName,
  CommandResult,
  ProviderPromptResult,
  ScenarioName,
} from "./types.js";

function truncate(value: string, limit = 400): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
}

function printCommandResult(
  label: string,
  result: CommandResult,
  artifactPath?: string,
): void {
  if (label.length > 0) {
    console.log(label);
  }
  console.log(`- Command: ${result.commandLine}`);
  console.log(`- Exit: ${result.exitCode ?? "none"}`);
  console.log(`- Duration: ${result.durationMs}ms`);

  if (artifactPath) {
    console.log(`- Artifact: ${artifactPath}`);
  }

  if (result.error) {
    console.log(`- Error: ${result.error}`);
  }

  if (result.stderr.trim().length > 0) {
    console.log(`- stderr: ${truncate(result.stderr.trim())}`);
  }
}

function printPromptResult(result: ProviderPromptResult): void {
  console.log("Prompt Run");
  console.log(`- Summary: ${result.summary}`);
  console.log(`- Final output: ${truncate(result.finalOutput || "(empty)")}`);
  console.log(`- Scenario: ${result.scenarioResult.summary}`);
  printCommandResult("", result.command, result.artifactPath);
}

function printTextResult(result: AgentCliTestResult): void {
  console.log(`Provider: ${result.provider}`);
  console.log(`Server: ${result.serverName}`);
  console.log(`Scenario: ${result.scenario}`);
  console.log(`Passed: ${result.passed ? "yes" : "no"}`);
  console.log("");

  if (result.health) {
    console.log("Health Check");
    console.log(`- Summary: ${result.health.summary}`);
    printCommandResult("", result.health.primaryCommand);
    if (result.health.secondaryCommand) {
      printCommandResult("", result.health.secondaryCommand);
    }
    if (result.health.metadata) {
      for (const [key, value] of Object.entries(result.health.metadata)) {
        if (value !== null) {
          console.log(`- ${key}: ${value}`);
        }
      }
    }
    console.log("");
  }

  printPromptResult(result.prompt);
}

const program = new Command();

interface CliOptions {
  provider: AgentProviderName;
  server?: string;
  scenario: ScenarioName;
  cwd?: string;
  setup: HarnessSetupName;
  timeoutMs: string;
  skipHealthCheck: boolean;
  json: boolean;
}

const defaultCwd = process.env.INIT_CWD ?? process.cwd();

program
  .name("sentry-agent-cli-test")
  .description("Run real Sentry MCP smoke tests through local agent CLIs")
  .requiredOption("--provider <provider>", "Agent CLI to use: claude or codex")
  .option("--setup <name>", "Harness setup to use: repo or stdio", "repo")
  .option("--server <name>", "Configured MCP server name")
  .option("--scenario <name>", "Smoke test scenario", "whoami")
  .option("--cwd <path>", "Working directory for the selected setup")
  .option("--timeout-ms <ms>", "Prompt timeout in milliseconds", "120000")
  .option("--skip-health-check", "Skip the MCP config/status check", false)
  .option("--json", "Emit JSON instead of text", false)
  .action(async (options: CliOptions) => {
    const providerName = options.provider;
    const scenarioName = options.scenario;
    const timeoutMs = Number(options.timeoutMs);

    if (!(providerName in { claude: true, codex: true })) {
      throw new Error(`Unsupported provider: ${options.provider}`);
    }

    if (!(options.setup in { repo: true, stdio: true })) {
      throw new Error(`Unsupported setup: ${options.setup}`);
    }

    if (!(scenarioName in SCENARIOS)) {
      throw new Error(`Unsupported scenario: ${options.scenario}`);
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`Invalid timeout: ${options.timeoutMs}`);
    }

    const provider = createProvider(providerName);
    const scenario = SCENARIOS[scenarioName];
    const harnessSetup = resolveHarnessSetup({
      setup: options.setup,
      cwd: options.cwd,
      server: options.server,
      defaultCwd,
    });

    const health = options.skipHealthCheck
      ? undefined
      : await provider.checkHealth(harnessSetup.serverName, harnessSetup.cwd);

    const prompt = await provider.runPrompt({
      serverName: harnessSetup.serverName,
      cwd: harnessSetup.cwd,
      prompt: scenario.buildPrompt(harnessSetup.serverName),
      timeoutMs,
    });

    const executionSummary = prompt.summary;
    prompt.scenarioResult = scenario.validate(prompt.finalOutput);
    prompt.passed = prompt.passed && prompt.scenarioResult.passed;
    prompt.summary = prompt.scenarioResult.passed
      ? prompt.scenarioResult.summary
      : `${prompt.scenarioResult.summary} Provider run: ${executionSummary}`;

    const result: AgentCliTestResult = {
      provider: providerName,
      serverName: harnessSetup.serverName,
      scenario: scenarioName,
      passed: prompt.passed,
      health,
      prompt,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printTextResult(result);
    }

    process.exit(result.passed ? 0 : 1);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
