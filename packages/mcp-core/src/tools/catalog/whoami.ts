import { z } from "zod";
import { defineTool } from "../../internal/tool-helpers/define";
import { apiServiceFromContext } from "../../internal/tool-helpers/api";
import { structuredResult } from "../../internal/tool-helpers/results";
import type { ServerContext } from "../../types";
import { ALL_SKILLS } from "../../skills";

export const whoamiOutputSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
  }),
  sessionConstraints: z
    .object({
      organizationSlug: z.string().optional(),
      projectSlug: z.string().optional(),
      regionUrl: z.string().optional(),
    })
    .nullable(),
});

export default defineTool({
  name: "whoami",
  description: [
    "Identify the authenticated user in Sentry.",
    "",
    "Use this tool when you need to:",
    "- Get the user's name and email address.",
  ].join("\n"),
  inputSchema: {},
  outputSchema: whoamiOutputSchema,
  skills: ALL_SKILLS, // Foundational tool - available to all skills
  requiredScopes: [], // No specific scopes required - uses authentication token
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(params, context: ServerContext) {
    // User data endpoints (like /auth/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
    // API client will throw ApiClientError/ApiServerError which the MCP server wrapper handles
    const user = await apiService.getAuthenticatedUser();

    const constraints = context.constraints;
    const sessionConstraints =
      constraints.organizationSlug ||
      constraints.projectSlug ||
      constraints.regionUrl
        ? {
            ...(constraints.organizationSlug
              ? { organizationSlug: constraints.organizationSlug }
              : {}),
            ...(constraints.projectSlug
              ? { projectSlug: constraints.projectSlug }
              : {}),
            ...(constraints.regionUrl
              ? { regionUrl: constraints.regionUrl }
              : {}),
          }
        : null;

    return structuredResult({
      user: {
        id: String(user.id),
        name: user.name ?? null,
        email: user.email,
      },
      sessionConstraints,
    });
  },
});
