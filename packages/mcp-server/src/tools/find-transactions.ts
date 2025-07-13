import { z } from "zod";
import { setTag } from "@sentry/core";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import type { ServerContext } from "../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamProjectId,
  ParamTransaction,
  ParamQuery,
} from "../schema";

export default defineTool({
  name: "find_transactions",
  description: [
    "Find transactions in Sentry using advanced search syntax.",
    "",
    "Transactions are segments of traces that are associated with a specific route or endpoint.",
    "",
    "Use this tool when you need to:",
    "- Search for production transaction data to understand performance.",
    "- Analyze traces and latency patterns.",
    "- Find examples of recent requests to endpoints.",
    "",
    "<examples>",
    "### Find slow requests to a route",
    "",
    "...",
    "",
    "```",
    "find_transactions(organizationSlug='my-organization', transaction='/checkout', sortBy='duration')",
    "```",
    "",
    "</examples>",
    "",
    "<hints>",
    "- If the user passes a parameter in the form of name/otherName, its likely in the format of <organizationSlug>/<projectId>.",
    "- If only one parameter is provided, and it could be either `organizationSlug` or `projectId`, its probably `organizationSlug`, but if you're really uncertain you might want to call `find_organizations()` first.",
    "- You can use the `find_tags()` tool to see what user-defined tags are available.",
    "</hints>",
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.optional(),
    projectId: ParamProjectId.optional(),
    transaction: ParamTransaction.optional(),
    query: ParamQuery.optional(),
    sortBy: z
      .enum(["timestamp", "duration"])
      .optional()
      .default("timestamp")
      .describe(
        "Sort the results either by the timestamp of the request (most recent first) or the duration of the request (longest first).",
      ),
  },
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl,
    });
    const organizationSlug = params.organizationSlug;

    setTag("organization.slug", organizationSlug);
    if (params.projectId) setTag("project.id", params.projectId);

    const eventList = await apiService.searchSpans({
      organizationSlug,
      projectId: params.projectId,
      transaction: params.transaction,
      query: params.query,
      sortBy: params.sortBy as "timestamp" | "duration" | undefined,
    });
    let output = `# Transactions in **${organizationSlug}${
      params.projectId ? `/${params.projectId}` : ""
    }**\n\n`;
    if (params.query)
      output += `These spans match the query \`${params.query}\`\n`;
    if (params.transaction)
      output += `These spans are limited to the transaction \`${params.transaction}\`\n`;
    output += "\n";
    if (eventList.length === 0) {
      output += `No results found\n\n`;
      output += `We searched within the ${organizationSlug} organization.\n\n`;
      return output;
    }
    for (const eventSummary of eventList) {
      output += `## \`${eventSummary.transaction}\`\n\n`;
      output += `**Span ID**: ${eventSummary.id}\n`;
      output += `**Trace ID**: ${eventSummary.trace}\n`;
      output += `**Span Operation**: ${eventSummary["span.op"]}\n`;
      output += `**Span Description**: ${eventSummary["span.description"]}\n`;
      output += `**Duration**: ${eventSummary["span.duration"]}\n`;
      output += `**Timestamp**: ${eventSummary.timestamp}\n`;
      output += `**Project**: ${eventSummary.project}\n`;
      output += `**URL**: ${apiService.getTraceUrl(
        organizationSlug,
        eventSummary.trace,
      )}\n\n`;
    }
    return output;
  },
});
