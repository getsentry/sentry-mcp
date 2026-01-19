/**
 * sentry project get
 *
 * Get detailed information about a Sentry project.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getProject } from "../../lib/api-client.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatProjectDetails,
  writeOutput,
} from "../../lib/formatters/index.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";

type GetFlags = {
  readonly org?: string;
  readonly json: boolean;
};

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
    const { stdout, cwd } = this;

    const resolved = await resolveOrgAndProject({
      org: flags.org,
      project: projectSlug,
      cwd,
    });

    if (!resolved) {
      throw new ContextError(
        "Organization and project",
        "sentry project get <project-slug> --org <org-slug>"
      );
    }

    const project = await getProject(resolved.org, resolved.project);

    writeOutput(stdout, project, {
      json: flags.json,
      formatHuman: formatProjectDetails,
      detectedFrom: resolved.detectedFrom,
    });
  },
});
