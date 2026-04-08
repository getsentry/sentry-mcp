import type { ScenarioName, ScenarioResult } from "./types.js";

export interface ScenarioDefinition {
  name: ScenarioName;
  buildPrompt(serverName: string): string;
  validate(finalOutput: string): ScenarioResult;
}

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export const WHOAMI_SCENARIO: ScenarioDefinition = {
  name: "whoami",
  buildPrompt(serverName) {
    return `Use the "whoami" tool from the MCP server named "${serverName}". Call it exactly once. Reply with only the authenticated email address.`;
  },
  validate(finalOutput) {
    const match = finalOutput.match(EMAIL_REGEX);

    if (!match) {
      return {
        passed: false,
        summary: "No authenticated email address found in the final response.",
      };
    }

    return {
      passed: true,
      summary: `Authenticated email: ${match[0]}`,
      email: match[0],
    };
  },
};

export const SCENARIOS: Record<ScenarioName, ScenarioDefinition> = {
  whoami: WHOAMI_SCENARIO,
};
