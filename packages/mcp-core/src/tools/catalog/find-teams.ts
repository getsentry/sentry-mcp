import { z } from "zod";
import { UserInputError } from "../../errors";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { defineTool } from "../../internal/tool-helpers/define";
import { structuredResult } from "../../internal/tool-helpers/results";
import {
  ParamCursor,
  ParamOrganizationSlug,
  ParamRegionUrl,
  ParamSearchQuery,
} from "../../schema";
import { setOrganizationContext } from "../../telem/organization";
import type { ServerContext } from "../../types";

const DEFAULT_LIMIT = 25;

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
    `Returns up to ${DEFAULT_LIMIT} results by default. Use limit to request up to 100 results. When hasMore is true, pass the returned nextCursor with the same filters and limit to fetch the next page.`,
  ].join("\n"),
  inputSchema: {
    organizationSlug: ParamOrganizationSlug,
    regionUrl: ParamRegionUrl.nullable().default(null),
    query: ParamSearchQuery.nullable().default(null),
    cursor: ParamCursor.nullable().default(null),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .describe("Maximum number of teams to return per page.")
      .default(DEFAULT_LIMIT),
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

    setOrganizationContext(organizationSlug);

    const { teams, nextCursor } = await apiService.listTeams(organizationSlug, {
      query: params.query ?? undefined,
      limit: params.limit,
      cursor: params.cursor ?? undefined,
    });

    return structuredResult({
      teams: teams.map((team) => ({ slug: team.slug, id: String(team.id) })),
      hasMore: nextCursor !== null,
      nextCursor,
    });
  },
});
