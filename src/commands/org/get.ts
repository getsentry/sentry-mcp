/**
 * sentry org get
 *
 * Get detailed information about a Sentry organization.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getOrganization } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import { formatOrgDetails, writeOutput } from "../../lib/formatters/index.js";
import { resolveOrg } from "../../lib/resolve-target.js";

type GetFlags = {
  readonly json: boolean;
};

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
    const { stdout, cwd } = this;

    const resolved = await resolveOrg({ org: orgSlug, cwd });

    if (!resolved) {
      throw new ContextError("Organization", "sentry org get <org-slug>");
    }

    const org = await getOrganization(resolved.org);

    writeOutput(stdout, org, {
      json: flags.json,
      formatHuman: formatOrgDetails,
      detectedFrom: resolved.detectedFrom,
    });
  },
});
