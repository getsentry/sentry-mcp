/**
 * sentry auth logout
 *
 * Clear stored authentication credentials.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { clearAuth, getConfigPath, isAuthenticated } from "../../lib/config.js";

export const logoutCommand = buildCommand({
  docs: {
    brief: "Log out of Sentry",
    fullDescription:
      "Remove stored authentication credentials from the configuration file.",
  },
  parameters: {
    flags: {},
  },
  func(this: SentryContext): void {
    const { process } = this;
    const { stdout } = process;

    if (!isAuthenticated()) {
      stdout.write("Not currently authenticated.\n");
      return;
    }

    clearAuth();
    stdout.write("✓ Logged out successfully.\n");
    stdout.write(`  Credentials removed from: ${getConfigPath()}\n`);
  },
});
