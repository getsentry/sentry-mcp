import { setTag } from "@sentry/core";
import { z } from "zod";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { structuredResult } from "../../internal/tool-helpers/results";
import { UserInputError } from "../../errors";
import type { ServerContext } from "../../types";
import {
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamSearchQuery,
} from "../../schema";

const RESULT_LIMIT = 100;

export const findTeamsOutputSchema = z.object({
  teams: z.array(
    z.object({
      slug: z.string(),
      id: z.string(),
    }),
  ),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export default defineTool({
  name: "find_teams",
  skills: ["inspect", "triage", "project-management"], // Team viewing and management
  requiredScopes: ["team:read"],
  description: [
    "Find teams in an organization in Sentry.",
    "",
    "Use this tool when you need to:",
    "- View teams in a Sentry organization",
    "- Find a team's slug and numeric ID to aid other tool requests",
    "- Search for specific teams by name or slug",
    "",
    `Returns up to ${RESULT_LIMIT} results. When hasMore is true, pass the returned nextCursor to fetch the next page, or use the query parameter to narrow down results.`,
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    query: ParamSearchQuery.nullable().default(null),
    cursor: z
      .string()
      .nullable()
      .default(null)
      .describe(
        "Pagination cursor from a previous call's nextCursor, to fetch the next page of results.",
      ),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  outputSchema: findTeamsOutputSchema,
  async handler(params, context: ServerContext) {
    const apiService = apiServiceFromContext(context, {
      regionUrl: params.regionUrl ?? undefined,
    });
    const organizationSlug = params.organizationSlug;

    if (!organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Please provide an organizationSlug parameter.",
      );
    }

    setTag("organization.slug", organizationSlug);

    const { teams, nextCursor } = await apiService.listTeams(organizationSlug, {
      query: params.query ?? undefined,
      limit: RESULT_LIMIT,
      cursor: params.cursor ?? undefined,
    });

    return structuredResult({
      teams: teams.map((team) => ({ slug: team.slug, id: String(team.id) })),
      hasMore: nextCursor !== null,
      nextCursor,
    });
  },
});
