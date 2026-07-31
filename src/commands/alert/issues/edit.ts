/**
 * sentry alert issues edit
 *
 * Update an issue alert rule (name and/or status). Fetches the current rule,
 * applies changes, and PUTs the full document to the Sentry API.
 */

import type { SentryContext } from "../../../context.js";
import {
  getIssueAlertRuleDocument,
  putIssueAlertRule,
} from "../../../lib/api-client.js";
import { parseOrgProjectArg } from "../../../lib/arg-parsing.js";
import { buildCommand, numberParser } from "../../../lib/command.js";
import { ContextError, ValidationError } from "../../../lib/errors.js";
import { CommandOutput } from "../../../lib/formatters/output.js";
import { resolveTargetsFromParsedArg } from "../../../lib/resolve-target.js";
import {
  parseJsonObjectList,
  parseMatchMode,
  parseStatusFlag,
  validateIssueRuleArrays,
} from "../mutation-utils.js";
import { parseIssueRuleArg, resolveIssueAlertRule } from "./rule-resolve.js";

const USAGE_HINT =
  "sentry alert issues edit <org>/<project>/<rule-id-or-name> --name <name> | --status active|disabled";

type EditFlags = {
  readonly name?: string;
  readonly status?: "active" | "disabled" | undefined;
  readonly condition?: string[];
  readonly action?: string[];
  readonly "action-match"?: "all" | "any";
  readonly frequency?: number;
  readonly environment?: string;
  readonly filter?: string[];
  readonly "filter-match"?: "all" | "any";
  readonly owner?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

type EditResult = Record<string, unknown> & {
  org: string;
  project: string;
  id: string;
};

function hasIssueMutations(flags: EditFlags): boolean {
  return (
    flags.name !== undefined ||
    flags.status !== undefined ||
    flags.condition !== undefined ||
    flags.action !== undefined ||
    flags["action-match"] !== undefined ||
    flags.frequency !== undefined ||
    flags.environment !== undefined ||
    flags.filter !== undefined ||
    flags["filter-match"] !== undefined ||
    flags.owner !== undefined
  );
}

function validateIssueEditFlags(flags: EditFlags): void {
  if (!hasIssueMutations(flags)) {
    throw new ValidationError(
      "Pass at least one editable field (for example --name or --status).",
      "name"
    );
  }
  if (flags.frequency !== undefined && flags.frequency <= 0) {
    throw new ValidationError("frequency must be greater than 0.", "frequency");
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-flag merge with user-only validation
function applyIssueEdits(
  body: Record<string, unknown>,
  flags: EditFlags
): Record<string, unknown> {
  const conditions = parseJsonObjectList(flags.condition, "condition");
  const actions = parseJsonObjectList(flags.action, "action");
  const filters = parseJsonObjectList(flags.filter, "filter");

  if (flags.name !== undefined) {
    body.name = flags.name;
  }
  if (flags.status !== undefined) {
    body.status = flags.status;
  }
  if (conditions !== undefined) {
    body.conditions = conditions;
  }
  if (actions !== undefined) {
    body.actions = actions;
  }
  if (flags["action-match"] !== undefined) {
    body.actionMatch = flags["action-match"];
  }
  if (flags.frequency !== undefined) {
    body.frequency = flags.frequency;
  }
  if (flags.environment !== undefined) {
    body.environment =
      flags.environment.trim() === "" ? null : flags.environment;
  }
  if (filters !== undefined) {
    body.filters = filters;
  }
  if (flags["filter-match"] !== undefined) {
    body.filterMatch = flags["filter-match"];
  }
  if (flags.owner !== undefined) {
    body.owner = flags.owner.trim() === "" ? null : flags.owner;
  }

  if (conditions !== undefined) {
    validateIssueRuleArrays(conditions, actions, "conditions");
  }
  if (actions !== undefined) {
    validateIssueRuleArrays(conditions, actions, "actions");
  }
  return body;
}

function formatEdited(r: EditResult): string {
  return `Updated issue alert rule ${r.id} in ${r.org}/${r.project}: ${String(r.name)} (${String(r.status)}).`;
}

export const editCommand = buildCommand({
  docs: {
    brief: "Edit an issue alert rule",
    fullDescription:
      "Update an issue alert rule by id or name. You must set at least one of --name or " +
      "--status.\n\n" +
      "The CLI loads the current rule, applies your changes, and updates it via the API.\n\n" +
      "Examples:\n" +
      "  sentry alert issues edit my-org/my-app/12 --name 'Prod errors'\n" +
      "  sentry alert issues edit my-org/my-app/'Old name' --status disabled\n" +
      "  sentry alert issues edit 12 --name 'Renamed' --status active\n" +
      '  sentry alert issues edit my-org/my-app/12 --condition \'{"id":"sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"}\'',
  },
  output: {
    human: formatEdited,
    jsonTransform: (r: EditResult) => r,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project/rule-id-or-name",
          brief: "Rule id or name (same as view)",
          parse: String,
        },
      ],
    },
    flags: {
      name: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New rule name",
      },
      status: {
        kind: "parsed",
        parse: parseStatusFlag,
        optional: true,
        brief: "Rule status: active or disabled",
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
        optional: true,
        brief: "Frequency in minutes",
      },
      environment: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Environment value (pass empty string to clear)",
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
        brief: "Owner value (pass empty string to clear)",
      },
    },
    aliases: {
      c: "condition",
      a: "action",
      m: "action-match",
    },
  },
  async *func(this: SentryContext, flags: EditFlags, arg: string) {
    const { cwd } = this;
    validateIssueEditFlags(flags);

    const { ref, targetArg } = parseIssueRuleArg(arg, USAGE_HINT);
    const parsed = parseOrgProjectArg(targetArg);
    const { targets } = await resolveTargetsFromParsedArg(parsed, {
      cwd,
      usageHint: USAGE_HINT,
    });
    if (targets.length === 0) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    const { target, rule } = await resolveIssueAlertRule(
      targets,
      ref,
      USAGE_HINT
    );

    const body = {
      ...(await getIssueAlertRuleDocument(target.org, target.project, rule.id)),
    } as Record<string, unknown>;
    applyIssueEdits(body, flags);

    const updated = await putIssueAlertRule(
      target.org,
      target.project,
      rule.id,
      body
    );
    yield new CommandOutput({
      ...updated,
      org: target.org,
      project: target.project,
      id: String(updated.id ?? rule.id),
    } satisfies EditResult);
  },
});
