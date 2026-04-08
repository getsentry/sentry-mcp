import path from "node:path";
import { fileURLToPath } from "node:url";

export type HarnessSetupName = "repo" | "stdio";

export interface ResolvedHarnessSetup {
  cwd: string;
  serverName: string;
}

function getFixtureProjectDir(name: Exclude<HarnessSetupName, "repo">): string {
  return fileURLToPath(new URL(`../projects/${name}`, import.meta.url));
}

export function resolveHarnessSetup(options: {
  setup: HarnessSetupName;
  cwd?: string;
  server?: string;
  defaultCwd: string;
}): ResolvedHarnessSetup {
  const { setup, defaultCwd } = options;

  switch (setup) {
    case "repo":
      return {
        cwd: path.resolve(options.cwd ?? defaultCwd),
        serverName: options.server ?? "sentry-dev",
      };
    case "stdio":
      return {
        cwd: path.resolve(options.cwd ?? getFixtureProjectDir("stdio")),
        serverName: options.server ?? "sentry-stdio",
      };
  }
}
