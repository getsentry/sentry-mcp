/**
 * sentry project get
 *
 * Get detailed information about a Sentry project.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getProject } from "../../lib/api-client.js";
import { formatProjectDetails } from "../../lib/formatters/human.js";
import { writeJson } from "../../lib/formatters/json.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";

type GetFlags = {
  readonly org?: string;
  readonly json: boolean;
};

/**
 * Write human-readable project output to stdout.
 *
 * @param stdout - Stream to write formatted output
 * @param project - Project data to display
 * @param detectedFrom - Optional source description if project was auto-detected
 */
function writeHumanOutput(
  stdout: Writer,
  project: Parameters<typeof formatProjectDetails>[0],
  detectedFrom?: string
): void {
  const lines = formatProjectDetails(project);
  stdout.write(`${lines.join("\n")}\n`);

  if (detectedFrom) {
    stdout.write(`\nDetected from ${detectedFrom}\n`);
  }
}

export const getCommand = buildCommand({
  docs: {
    brief: "Get details of a project",
    fullDescription:
      "Retrieve detailed information about a Sentry project.\n\n" +
      "The organization and project are resolved from:\n" +
      "  1. Positional argument <project-slug> and --org flag\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable or source code detection",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Project slug (optional if auto-detected)",
          parse: String,
          optional: true,
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
    projectSlug?: string
  ): Promise<void> {
    const { process, cwd } = this;
    const { stdout } = process;

    const resolved = await resolveOrgAndProject({
      org: flags.org,
      project: projectSlug,
      cwd,
    });

    if (!resolved) {
      throw new Error(
        "Organization and project are required.\n\n" +
          "Please specify them using:\n" +
          "  sentry project get <project-slug> --org <org-slug>\n\n" +
          "Or set SENTRY_DSN environment variable for automatic detection."
      );
    }

    const project = await getProject(resolved.org, resolved.project);

    if (flags.json) {
      writeJson(stdout, project);
      return;
    }

    writeHumanOutput(stdout, project, resolved.detectedFrom);
  },
});
