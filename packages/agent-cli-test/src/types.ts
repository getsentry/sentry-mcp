export type AgentProviderName = "claude" | "codex";

export type ScenarioName = "whoami";

export interface CommandResult {
  commandLine: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  error?: string;
  timedOut: boolean;
}

export interface ProviderHealthResult {
  passed: boolean;
  summary: string;
  primaryCommand: CommandResult;
  secondaryCommand?: CommandResult;
  metadata?: Record<string, string | null>;
}

export interface ScenarioResult {
  passed: boolean;
  summary: string;
  email?: string;
}

export interface ProviderPromptResult {
  passed: boolean;
  summary: string;
  command: CommandResult;
  finalOutput: string;
  scenarioResult: ScenarioResult;
  artifactPath?: string;
}

export interface AgentProvider {
  name: AgentProviderName;
  checkHealth(serverName: string, cwd: string): Promise<ProviderHealthResult>;
  runPrompt(input: {
    serverName: string;
    cwd: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<ProviderPromptResult>;
}

export interface AgentCliTestResult {
  provider: AgentProviderName;
  serverName: string;
  scenario: ScenarioName;
  passed: boolean;
  health?: ProviderHealthResult;
  prompt: ProviderPromptResult;
}
