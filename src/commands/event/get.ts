/**
 * sentry event get
 *
 * Get detailed information about a Sentry event.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getEvent } from "../../lib/api-client.js";
import { formatEventDetails } from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import type { SentryEvent } from "../../types/index.js";

type GetFlags = {
  readonly org?: string;
  readonly project?: string;
  readonly json: boolean;
};

/**
 * Write human-readable event output to stdout.
 *
 * @param stdout - Output stream
 * @param event - The event to display
 * @param detectedFrom - Optional source description for auto-detection
 */
function writeHumanOutput(
  stdout: Writer,
  event: SentryEvent,
  detectedFrom?: string
): void {
  const lines = formatEventDetails(event, `Event ${event.eventID}`);

  // Skip leading empty line for standalone display
  const output = lines.slice(1);
  stdout.write(`${output.join("\n")}\n`);

  if (detectedFrom) {
    stdout.write(`\nDetected from ${detectedFrom}\n`);
  }
}

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of a specific event",
    fullDescription:
      "Retrieve detailed information about a Sentry event by its ID.\n\n" +
      "The organization and project are resolved from:\n" +
      "  1. --org and --project flags\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable or source code detection",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief:
            "Event ID (hexadecimal, e.g., 9999aaaaca8b46d797c23c6077c6ff01)",
          parse: String,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Project slug",
        optional: true,
      },
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
    eventId: string
  ): Promise<void> {
    const { process, cwd } = this;
    const { stdout } = process;

    const target = await resolveOrgAndProject({
      org: flags.org,
      project: flags.project,
      cwd,
    });

    if (!target) {
      throw new Error(
        "Organization and project are required to fetch an event.\n\n" +
          "Please specify them using:\n" +
          `  sentry event get ${eventId} --org <org-slug> --project <project-slug>\n\n` +
          "Or set SENTRY_DSN environment variable for automatic detection."
      );
    }

    const event = await getEvent(target.org, target.project, eventId);

    if (flags.json) {
      writeJson(stdout, event);
      return;
    }

    writeHumanOutput(stdout, event, target.detectedFrom);
  },
});
