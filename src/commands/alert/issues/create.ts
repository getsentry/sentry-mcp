/**
 * sentry alert issues create
 *
 * Create a project-scoped issue alert rule.
 */

import type { SentryContext } from "../../../context.js";
import { createIssueAlertRule } from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ContextError, ValidationError } from "../../../lib/errors.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { DRY_RUN_ALIASES, DRY_RUN_FLAG } from "../../../lib/mutate-command.js";
import { resolveTargetsFromParsedArg } from "../../../lib/resolve-target.js";
import {
  parseJsonObjectList,
  parseMatchMode,
  validateIssueRuleArrays,
} from "../mutation-utils.js";

const USAGE_HINT =
  "sentry alert issues create <target> --name <name> --condition <json> --action <json> --action-match all|any";

type CreateFlags = {
  readonly name: string;
  readonly condition?: string[];
  readonly action?: string[];
  readonly "action-match"?: "all" | "any";
  readonly frequency: number;
  readonly environment?: string;
  readonly filter?: string[];
  readonly "filter-match"?: "all" | "any";
  readonly owner?: string;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

type CreateResult = {
  org: string;
  project: string;
  id?: string;
  name: string;
  status?: string;
  dryRun?: boolean;
  body?: Record<string, unknown>;
};

function formatCreated(result: CreateResult): string {
  if (result.dryRun) {
    return `Would create issue alert rule '${result.name}' in ${result.org}/${result.project}.`;
  }
  return `Created issue alert rule ${result.id ?? "(unknown id)"} in ${result.org}/${result.project}: ${result.name} (${result.status ?? "active"}).`;
}

export const createCommand = buildCommand({
  docs: {
    brief: "Create an issue alert rule",
    fullDescription:
      "Create a project-scoped issue alert rule. The target may be an explicit " +
      "<org>/<project>, an auto-detected project, or a bare project search when " +
      "it resolves to exactly one project.\n\n" +
      "Required fields:\n" +
      "  --name, --condition (>=1), --action (>=1), --action-match all|any\n\n" +
      "Optional fields:\n" +
      "  --frequency, --environment, --filter, --filter-match, --owner\n\n" +
      "Examples:\n" +
      "  sentry alert issues create my-org/my-app --name 'Error Spike' \\\n" +
      '    --condition \'{"id":"sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"}\' \\\n' +
      '    --action \'{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"Team","targetIdentifier":1}\' \\\n' +
      "    --action-match any\n\n" +
      "  sentry alert issues create my-org/my-app --name 'Prod Errors' \\\n" +
      '    --condition \'[{"id":"sentry.rules.conditions.every_event.EveryEventCondition"}]\' \\\n' +
      '    --action \'[{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"Team","targetIdentifier":1}]\' \\\n' +
      "    --action-match all --frequency 30 --dry-run",
  },
  output: {
    human: formatCreated,
    jsonTransform: (result: CreateResult) => result,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief:
            "<org>/<project>, auto-detected project, or <project> (search)",
          parse: String,
          optional: true as const,
        },
      ],
    },
    flags: {
      name: {
        kind: "parsed",
        parse: String,
        brief: "Rule name",
      },
      condition: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief: "Condition object JSON (repeatable, or pass one JSON array)",
      },
      action: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief: "Action object JSON (repeatable, or pass one JSON array)",
      },
      "action-match": {
        kind: "parsed",
        parse: (value: string) => parseMatchMode(value, "action-match"),
        optional: true,
        brief: "Condition/action match mode: all or any",
      },
      frequency: {
        kind: "parsed",
        parse: numberParser,
        default: 30,
        brief: "Frequency in minutes (default: 30)",
      },
      environment: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Environment filter",
      },
      filter: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief: "Filter object JSON (repeatable, or pass one JSON array)",
      },
      "filter-match": {
        kind: "parsed",
        parse: (value: string) => parseMatchMode(value, "filter-match"),
        optional: true,
        brief: "Filter match mode: all or any",
      },
      owner: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Owner (team:user style value accepted by Sentry API)",
      },
      "dry-run": DRY_RUN_FLAG,
    },
    aliases: {
      ...DRY_RUN_ALIASES,
      c: "condition",
      a: "action",
      m: "action-match",
    },
  },
  async *func(
    this: SentryContext,
    flags: CreateFlags,
    arg: string | undefined
  ) {
    const { cwd } = this;
    if (!flags.name.trim()) {
      throw new ValidationError("Rule name cannot be empty.", "name");
    }
    if (flags.frequency <= 0) {
      throw new ValidationError(
        "frequency must be greater than 0.",
        "frequency"
      );
    }
    if (!flags["action-match"]) {
      throw new ValidationError(
        "Pass --action-match with one of: all, any.",
        "action-match"
      );
    }

    const conditions = parseJsonObjectList(flags.condition, "condition");
    const actions = parseJsonObjectList(flags.action, "action");
    const filters = parseJsonObjectList(flags.filter, "filter");
    validateIssueRuleArrays(conditions, actions, "conditions");
    validateIssueRuleArrays(conditions, actions, "actions");

    const parsed = parseOrgProjectArg(arg);
    const { targets } = await resolveTargetsFromParsedArg(parsed, {
      cwd,
      usageHint: USAGE_HINT,
    });
    if (targets.length === 0) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }
    if (targets.length !== 1) {
      throw new ValidationError(
        "Provide a target that resolves to exactly one project for create.",
        "target"
      );
    }
    const target = targets[0] as (typeof targets)[number];

    const body: Record<string, unknown> = {
      name: flags.name,
      conditions,
      actions,
      actionMatch: flags["action-match"],
      frequency: flags.frequency,
    };
    if (flags.environment !== undefined) {
      body.environment = flags.environment;
    }
    if (filters && filters.length > 0) {
      body.filters = filters;
      body.filterMatch = flags["filter-match"] ?? "all";
    } else if (flags["filter-match"] !== undefined) {
      body.filterMatch = flags["filter-match"];
    }
    if (flags.owner !== undefined) {
      body.owner = flags.owner;
    }

    if (flags["dry-run"]) {
      yield new CommandOutput({
        org: target.org,
        project: target.project,
        name: flags.name,
        dryRun: true,
        body,
      } satisfies CreateResult);
      return { hint: "Dry run - no issue alert rule was created." };
    }

    const created = await createIssueAlertRule(
      target.org,
      target.project,
      body
    );
    yield new CommandOutput({
      org: target.org,
      project: target.project,
      id: String(created.id ?? ""),
      name: String(created.name ?? flags.name),
      status: String(created.status ?? "active"),
    } satisfies CreateResult);
  },
});
