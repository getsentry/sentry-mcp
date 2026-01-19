/**
 * sentry org get
 *
 * Get detailed information about a Sentry organization.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getOrganization } from "../../lib/api-client.js";
import { formatOrgDetails } from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import { resolveOrg } from "../../lib/resolve-target.js";

type GetFlags = {
  readonly json: boolean;
};

/**
 * Write human-readable organization output to stdout.
 *
 * @param stdout - Stream to write formatted output
 * @param org - Organization data to display
 * @param detectedFrom - Optional source description if org was auto-detected
 */
function writeHumanOutput(
  stdout: Writer,
  org: Parameters<typeof formatOrgDetails>[0],
  detectedFrom?: string
): void {
  const lines = formatOrgDetails(org);
  stdout.write(`${lines.join("\n")}\n`);

  if (detectedFrom) {
    stdout.write(`\nDetected from ${detectedFrom}\n`);
  }
}

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of an organization",
    fullDescription:
      "Retrieve detailed information about a Sentry organization.\n\n" +
      "The organization is resolved from:\n" +
      "  1. Positional argument <org-slug>\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable or source code detection",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Organization slug (optional if auto-detected)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(
    this: SentryContext,
    flags: GetFlags,
    orgSlug?: string
  ): Promise<void> {
    const { process, cwd } = this;
    const { stdout } = process;

    const resolved = await resolveOrg({ org: orgSlug, cwd });

    if (!resolved) {
      throw new Error(
        "Organization is required.\n\n" +
          "Please specify it using:\n" +
          "  sentry org get <org-slug>\n\n" +
          "Or set SENTRY_DSN environment variable for automatic detection."
      );
    }

    const org = await getOrganization(resolved.org);

    if (flags.json) {
      writeJson(stdout, org);
      return;
    }

    writeHumanOutput(stdout, org, resolved.detectedFrom);
  },
});
