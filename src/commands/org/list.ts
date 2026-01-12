/**
 * sentry org list
 *
 * List organizations the user has access to.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import {
  calculateOrgSlugWidth,
  formatOrgRow,
} from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
};

export const listCommand = buildCommand({
  docs: {
    brief: "List organizations",
    fullDescription:
      "List organizations that you have access to.\n\n" +
      "Examples:\n" +
      "  sentry org list\n" +
      "  sentry org list --limit 10\n" +
      "  sentry org list --json",
  },
  parameters: {
    flags: {
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of organizations to list",
        default: 30,
      },
      json: {
        kind: "boolean",
        brief: "Output JSON",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { process } = this;
    const { stdout, stderr } = process;

    try {
      const orgs = await listOrganizations();
      const limitedOrgs = orgs.slice(0, flags.limit);

      if (flags.json) {
        writeJson(stdout, limitedOrgs);
        return;
      }

      if (limitedOrgs.length === 0) {
        stdout.write("No organizations found.\n");
        return;
      }

      const slugWidth = calculateOrgSlugWidth(limitedOrgs);

      // Header
      stdout.write(`${"SLUG".padEnd(slugWidth)}  NAME\n`);

      // Rows
      for (const org of limitedOrgs) {
        stdout.write(`${formatOrgRow(org, slugWidth)}\n`);
      }

      if (orgs.length > flags.limit) {
        stdout.write(
          `\nShowing ${flags.limit} of ${orgs.length} organizations\n`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Error listing organizations: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
