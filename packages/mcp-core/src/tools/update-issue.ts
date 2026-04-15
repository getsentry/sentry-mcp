import { setTag } from "@sentry/core";
import { defineTool } from "../internal/tool-helpers/define";
import { apiServiceFromContext } from "../internal/tool-helpers/api";
import { parseIssueParams } from "../internal/tool-helpers/issue";
import { formatAssignedTo } from "../internal/tool-helpers/formatting";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamIssueShortId,
  ParamIssueUrl,
  ParamIssueStatus,
  ParamIssueIgnoreMode,
  ParamAssignedTo,
  ParamIgnoreDurationMinutes,
  ParamIgnoreCount,
  ParamIgnoreWindowMinutes,
  ParamIgnoreUserCount,
  ParamIgnoreUserWindowMinutes,
} from "../schema";

type IgnoreMode =
  | "untilEscalating"
  | "forever"
  | "forDuration"
  | "untilOccurrenceCount"
  | "untilUserCount";

type IgnoreUpdate = {
  substatus:
    | "archived_until_escalating"
    | "archived_forever"
    | "archived_until_condition_met";
  ignoreDuration?: number;
  ignoreCount?: number;
  ignoreWindow?: number;
  ignoreUserCount?: number;
  ignoreUserWindow?: number;
  behavior: string;
  message: string;
};

function pluralize(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function inferIgnoreMode(params: {
  ignoreMode?: IgnoreMode;
  ignoreDurationMinutes?: number;
  ignoreCount?: number;
  ignoreWindowMinutes?: number;
  ignoreUserCount?: number;
  ignoreUserWindowMinutes?: number;
}): IgnoreMode {
  if (params.ignoreMode) {
    return params.ignoreMode;
  }

  if (params.ignoreDurationMinutes !== undefined) {
    return "forDuration";
  }

  if (
    params.ignoreCount !== undefined ||
    params.ignoreWindowMinutes !== undefined
  ) {
    return "untilOccurrenceCount";
  }

  if (
    params.ignoreUserCount !== undefined ||
    params.ignoreUserWindowMinutes !== undefined
  ) {
    return "untilUserCount";
  }

  return "untilEscalating";
}

function getIgnoreBehavior(
  substatus: string | null | undefined,
  ignoreUpdate?: IgnoreUpdate,
): string | null {
  switch (substatus) {
    case "archived_until_escalating":
      return "Until escalating";
    case "archived_forever":
      return "Forever";
    case "archived_until_condition_met":
      return ignoreUpdate?.behavior ?? "Until the ignore condition is met";
    default:
      return null;
  }
}

function getIgnoredStatusMessage(
  substatus: string | null | undefined,
  ignoreUpdate?: IgnoreUpdate,
): string {
  switch (substatus) {
    case "archived_until_escalating":
      return "The issue is now ignored until it escalates";
    case "archived_forever":
      return "The issue is now ignored indefinitely";
    case "archived_until_condition_met":
      return (
        ignoreUpdate?.message ??
        "The issue is now ignored until the configured condition is met"
      );
    default:
      return "The issue is now ignored";
  }
}

function buildIgnoreUpdate(params: {
  status?: string;
  ignoreMode?: IgnoreMode;
  ignoreDurationMinutes?: number;
  ignoreCount?: number;
  ignoreWindowMinutes?: number;
  ignoreUserCount?: number;
  ignoreUserWindowMinutes?: number;
}): IgnoreUpdate | undefined {
  const hasIgnoreOptions =
    params.ignoreMode !== undefined ||
    params.ignoreDurationMinutes !== undefined ||
    params.ignoreCount !== undefined ||
    params.ignoreWindowMinutes !== undefined ||
    params.ignoreUserCount !== undefined ||
    params.ignoreUserWindowMinutes !== undefined;

  if (!hasIgnoreOptions) {
    if (params.status === "ignored") {
      return {
        substatus: "archived_until_escalating",
        behavior: "Until escalating",
        message: "The issue is now ignored until it escalates",
      };
    }

    return undefined;
  }

  if (params.status !== "ignored") {
    throw new UserInputError(
      "Ignore options can only be used when `status` is `ignored`",
    );
  }

  if (
    params.ignoreWindowMinutes !== undefined &&
    params.ignoreCount === undefined
  ) {
    throw new UserInputError("`ignoreWindowMinutes` requires `ignoreCount`");
  }

  if (
    params.ignoreUserWindowMinutes !== undefined &&
    params.ignoreUserCount === undefined
  ) {
    throw new UserInputError(
      "`ignoreUserWindowMinutes` requires `ignoreUserCount`",
    );
  }

  const usesDuration = params.ignoreDurationMinutes !== undefined;
  const usesOccurrence =
    params.ignoreCount !== undefined ||
    params.ignoreWindowMinutes !== undefined;
  const usesUserCount =
    params.ignoreUserCount !== undefined ||
    params.ignoreUserWindowMinutes !== undefined;

  const configuredIgnoreFamilies = [
    usesDuration,
    usesOccurrence,
    usesUserCount,
  ].filter(Boolean).length;

  if (configuredIgnoreFamilies > 1) {
    throw new UserInputError(
      "Choose only one ignore condition: duration, occurrence count, or user count",
    );
  }

  const ignoreMode = inferIgnoreMode(params);

  switch (ignoreMode) {
    case "untilEscalating":
      if (configuredIgnoreFamilies > 0) {
        throw new UserInputError(
          "`ignoreMode='untilEscalating'` cannot be combined with ignore duration, occurrence, or user-count conditions",
        );
      }
      return {
        substatus: "archived_until_escalating",
        behavior: "Until escalating",
        message: "The issue is now ignored until it escalates",
      };
    case "forever":
      if (configuredIgnoreFamilies > 0) {
        throw new UserInputError(
          "`ignoreMode='forever'` cannot be combined with ignore duration, occurrence, or user-count conditions",
        );
      }
      return {
        substatus: "archived_forever",
        behavior: "Forever",
        message: "The issue is now ignored indefinitely",
      };
    case "forDuration":
      if (params.ignoreDurationMinutes === undefined) {
        throw new UserInputError(
          "`ignoreMode='forDuration'` requires `ignoreDurationMinutes`",
        );
      }
      if (usesOccurrence || usesUserCount) {
        throw new UserInputError(
          "`ignoreMode='forDuration'` cannot be combined with ignore occurrence or user-count conditions",
        );
      }
      return {
        substatus: "archived_until_condition_met",
        ignoreDuration: params.ignoreDurationMinutes,
        behavior: `For ${pluralize(params.ignoreDurationMinutes, "minute")}`,
        message: `The issue is now ignored for ${pluralize(params.ignoreDurationMinutes, "minute")}`,
      };
    case "untilOccurrenceCount":
      if (params.ignoreCount === undefined) {
        throw new UserInputError(
          "`ignoreMode='untilOccurrenceCount'` requires `ignoreCount`",
        );
      }
      if (usesDuration || usesUserCount) {
        throw new UserInputError(
          "`ignoreMode='untilOccurrenceCount'` cannot be combined with ignore duration or user-count conditions",
        );
      }
      return {
        substatus: "archived_until_condition_met",
        ignoreCount: params.ignoreCount,
        ignoreWindow: params.ignoreWindowMinutes,
        behavior:
          params.ignoreWindowMinutes === undefined
            ? `Until it occurs ${pluralize(params.ignoreCount, "time")}`
            : `Until it occurs ${pluralize(params.ignoreCount, "time")} in ${pluralize(params.ignoreWindowMinutes, "minute")}`,
        message:
          params.ignoreWindowMinutes === undefined
            ? `The issue is now ignored until it occurs ${pluralize(params.ignoreCount, "time")}`
            : `The issue is now ignored until it occurs ${pluralize(params.ignoreCount, "time")} in ${pluralize(params.ignoreWindowMinutes, "minute")}`,
      };
    case "untilUserCount":
      if (params.ignoreUserCount === undefined) {
        throw new UserInputError(
          "`ignoreMode='untilUserCount'` requires `ignoreUserCount`",
        );
      }
      if (usesDuration || usesOccurrence) {
        throw new UserInputError(
          "`ignoreMode='untilUserCount'` cannot be combined with ignore duration or occurrence conditions",
        );
      }
      return {
        substatus: "archived_until_condition_met",
        ignoreUserCount: params.ignoreUserCount,
        ignoreUserWindow: params.ignoreUserWindowMinutes,
        behavior:
          params.ignoreUserWindowMinutes === undefined
            ? `Until it affects ${pluralize(params.ignoreUserCount, "user")}`
            : `Until it affects ${pluralize(params.ignoreUserCount, "user")} in ${pluralize(params.ignoreUserWindowMinutes, "minute")}`,
        message:
          params.ignoreUserWindowMinutes === undefined
            ? `The issue is now ignored until it affects ${pluralize(params.ignoreUserCount, "user")}`
            : `The issue is now ignored until it affects ${pluralize(params.ignoreUserCount, "user")} in ${pluralize(params.ignoreUserWindowMinutes, "minute")}`,
      };
  }

  throw new UserInputError("Unsupported ignore mode");
}

export default defineTool({
  name: "update_issue",
  skills: ["triage"], // Only available in triage skill
  requiredScopes: ["event:write"],
  description: [
    "Update a Sentry issue's status or assignment.",
    "",
    "Use this to resolve, reopen, assign, or ignore an issue.",
    "",
    "<examples>",
    "```",
    "update_issue(organizationSlug='my-org', issueId='PROJECT-123', status='resolved')",
    "update_issue(organizationSlug='my-org', issueId='PROJECT-123', assignedTo='user:123456')",
    "update_issue(organizationSlug='my-org', issueId='PROJECT-123', status='ignored')",
    "update_issue(organizationSlug='my-org', issueId='PROJECT-123', status='ignored', ignoreMode='forever')",
    "update_issue(organizationSlug='my-org', issueId='PROJECT-123', status='ignored', ignoreMode='untilOccurrenceCount', ignoreCount=100, ignoreWindowMinutes=60)",
    "```",
    "</examples>",
    "",
    "<hints>",
    "- Provide `issueUrl` or `organizationSlug` + `issueId`.",
    "- At least one of `status` or `assignedTo` is required.",
    "- `assignedTo` format: `user:ID` or `team:ID_OR_SLUG`.",
    "- Use `whoami` to find your user ID for self-assignment.",
    "- Status values: `resolved`, `resolvedInNextRelease`, `unresolved`, `ignored`.",
    "- `status='ignored'` defaults to `ignoreMode='untilEscalating'`.",
    "- Ignore modes: `untilEscalating`, `forever`, `forDuration`, `untilOccurrenceCount`, `untilUserCount`.",
    "- Matching ignore inputs are `ignoreDurationMinutes`, `ignoreCount` + optional `ignoreWindowMinutes`, or `ignoreUserCount` + optional `ignoreUserWindowMinutes`.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug.optional(),
    regionUrl: ParamRegionUrl.nullable().default(null),
    issueId: ParamIssueShortId.optional(),
    issueUrl: ParamIssueUrl.optional(),
    status: ParamIssueStatus.optional(),
    assignedTo: ParamAssignedTo.optional(),
    ignoreMode: ParamIssueIgnoreMode.optional(),
    ignoreDurationMinutes: ParamIgnoreDurationMinutes.optional(),
    ignoreCount: ParamIgnoreCount.optional(),
    ignoreWindowMinutes: ParamIgnoreWindowMinutes.optional(),
    ignoreUserCount: ParamIgnoreUserCount.optional(),
    ignoreUserWindowMinutes: ParamIgnoreUserWindowMinutes.optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });

    // Validate that we have the minimum required parameters
    if (!params.issueUrl && !params.issueId) {
      throw new UserInputError(
        "Either `issueId` or `issueUrl` must be provided",
      );
    }

    if (!params.issueUrl && !params.organizationSlug) {
      throw new UserInputError(
        "`organizationSlug` is required when providing `issueId`",
      );
    }

    // Validate that at least one update parameter is provided
    if (!params.status && !params.assignedTo) {
      throw new UserInputError(
        "At least one of `status` or `assignedTo` must be provided to update the issue",
      );
    }

    const { organizationSlug: orgSlug, issueId: parsedIssueId } =
      parseIssueParams({
        organizationSlug: params.organizationSlug,
        issueId: params.issueId,
        issueUrl: params.issueUrl,
      });

    const ignoreUpdate = buildIgnoreUpdate(params);

    setTag("organization.slug", orgSlug);

    // Get current issue details first
    const currentIssue = await apiService.getIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
    });

    // Update the issue
    const updatedIssue = await apiService.updateIssue({
      organizationSlug: orgSlug,
      issueId: parsedIssueId!,
      status: params.status,
      assignedTo: params.assignedTo,
      substatus: ignoreUpdate?.substatus,
      ignoreDuration: ignoreUpdate?.ignoreDuration,
      ignoreCount: ignoreUpdate?.ignoreCount,
      ignoreWindow: ignoreUpdate?.ignoreWindow,
      ignoreUserCount: ignoreUpdate?.ignoreUserCount,
      ignoreUserWindow: ignoreUpdate?.ignoreUserWindow,
    });

    let output = `# Issue ${updatedIssue.shortId} Updated in **${orgSlug}**\n\n`;
    output += `**Issue**: ${updatedIssue.title}\n`;
    output += `**URL**: ${apiService.getIssueUrl(orgSlug, updatedIssue.shortId)}\n\n`;

    // Show what changed
    output += "## Changes Made\n\n";

    if (params.status && currentIssue.status !== params.status) {
      output += `**Status**: ${currentIssue.status} → **${params.status}**\n`;
    }

    const previousIgnoreBehavior =
      currentIssue.status === "ignored"
        ? getIgnoreBehavior(currentIssue.substatus)
        : null;
    const currentIgnoreBehavior = getIgnoreBehavior(
      updatedIssue.substatus,
      ignoreUpdate,
    );
    if (
      ignoreUpdate &&
      currentIgnoreBehavior &&
      previousIgnoreBehavior !== currentIgnoreBehavior
    ) {
      if (previousIgnoreBehavior) {
        output += `**Ignore Behavior**: ${previousIgnoreBehavior} → **${currentIgnoreBehavior}**\n`;
      } else {
        output += `**Ignore Behavior**: **${currentIgnoreBehavior}**\n`;
      }
    }

    if (params.assignedTo) {
      const oldAssignee = formatAssignedTo(currentIssue.assignedTo ?? null);
      const newAssignee =
        params.assignedTo === "me" ? "You" : params.assignedTo;
      output += `**Assigned To**: ${oldAssignee} → **${newAssignee}**\n`;
    }

    output += "\n## Current Status\n\n";
    output += `**Status**: ${updatedIssue.status}\n`;
    if (updatedIssue.status === "ignored") {
      if (currentIgnoreBehavior) {
        output += `**Ignore Behavior**: ${currentIgnoreBehavior}\n`;
      }
    }
    const currentAssignee = formatAssignedTo(updatedIssue.assignedTo ?? null);
    output += `**Assigned To**: ${currentAssignee}\n`;

    output += "\n# Using this information\n\n";
    output += `- The issue has been successfully updated in Sentry\n`;
    output += `- You can view the issue details using: \`get_sentry_resource(resourceType="issue", organizationSlug="${orgSlug}", resourceId="${updatedIssue.shortId}")\`\n`;

    if (params.status === "resolved") {
      output += `- The issue is now marked as resolved and will no longer generate alerts\n`;
    } else if (params.status === "ignored") {
      output += `- ${getIgnoredStatusMessage(updatedIssue.substatus, ignoreUpdate)}\n`;
    }

    return output;
  },
});
