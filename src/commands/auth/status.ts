/**
 * sentry auth status
 *
 * Display authentication status and verify credentials.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import {
  getConfigPath,
  getDefaultOrganization,
  getDefaultProject,
  isAuthenticated,
  readConfig,
} from "../../lib/config.js";
import { formatExpiration, maskToken } from "../../lib/formatters/human.js";
import type { SentryConfig } from "../../types/index.js";

type StatusFlags = {
  readonly showToken: boolean;
};

/**
 * Write token information
 */
function writeTokenInfo(
  stdout: NodeJS.WriteStream,
  config: SentryConfig,
  showToken: boolean
): void {
  if (!config.auth?.token) {
    return;
  }

  const tokenDisplay = showToken
    ? config.auth.token
    : maskToken(config.auth.token);
  stdout.write(`Token: ${tokenDisplay}\n`);

  if (config.auth.expiresAt) {
    stdout.write(`Expires: ${formatExpiration(config.auth.expiresAt)}\n`);
  }
}

/**
 * Write default settings
 */
function writeDefaults(stdout: NodeJS.WriteStream): void {
  const defaultOrg = getDefaultOrganization();
  const defaultProject = getDefaultProject();

  if (!(defaultOrg || defaultProject)) {
    return;
  }

  stdout.write("\nDefaults:\n");
  if (defaultOrg) {
    stdout.write(`  Organization: ${defaultOrg}\n`);
  }
  if (defaultProject) {
    stdout.write(`  Project: ${defaultProject}\n`);
  }
}

/**
 * Verify credentials by fetching organizations
 */
async function verifyCredentials(stdout: NodeJS.WriteStream): Promise<void> {
  stdout.write("\nVerifying credentials...\n");

  try {
    const orgs = await listOrganizations();
    stdout.write(
      `\n✓ Access verified. You have access to ${orgs.length} organization(s):\n`
    );

    const maxDisplay = 5;
    for (const org of orgs.slice(0, maxDisplay)) {
      stdout.write(`  - ${org.name} (${org.slug})\n`);
    }
    if (orgs.length > maxDisplay) {
      stdout.write(`  ... and ${orgs.length - maxDisplay} more\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stdout.write(`\n✗ Could not verify credentials: ${message}\n`);
  }
}

export const statusCommand = buildCommand({
  docs: {
    brief: "View authentication status",
    fullDescription:
      "Display information about your current authentication status, " +
      "including whether you're logged in and your default organization/project settings.",
  },
  parameters: {
    flags: {
      showToken: {
        kind: "boolean",
        brief: "Show the stored token (masked by default)",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: StatusFlags): Promise<void> {
    const { process } = this;
    const { stdout } = process;

    const config = readConfig();
    const authenticated = isAuthenticated();

    stdout.write(`Config file: ${getConfigPath()}\n\n`);

    if (!authenticated) {
      stdout.write("Status: Not authenticated\n");
      stdout.write("\nRun 'sentry auth login' to authenticate.\n");
      return;
    }

    stdout.write("Status: Authenticated ✓\n\n");

    writeTokenInfo(stdout, config, flags.showToken);
    writeDefaults(stdout);
    await verifyCredentials(stdout);
  },
});
