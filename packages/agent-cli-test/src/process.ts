import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

function quoteArg(arg: string): string {
  return /^[a-zA-Z0-9_./:@%+=,-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

export function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args.map(quoteArg)].join(" ");
}

export async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CommandResult> {
  const { command, args, cwd, timeoutMs } = input;
  const commandLine = formatCommandLine(command, args);
  const startedAt = Date.now();

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;

    const finish = (partial: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      error?: string;
    }) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }

      resolve({
        commandLine,
        stdout,
        stderr,
        exitCode: partial.exitCode,
        signal: partial.signal,
        durationMs: Date.now() - startedAt,
        error: partial.error,
        timedOut,
      });
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });

    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
      });
    });
  });
}
