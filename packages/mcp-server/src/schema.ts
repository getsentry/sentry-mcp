import { z } from "zod";

export const ParamOrganizationSlug = z
  .string()
  .describe(
    "The organization's slug. This will default to the first org you have access to.",
  );

export const ParamTeamSlug = z
  .string()
  .describe(
    "The team's slug. This will default to the first team you have access to.",
  );

export const ParamProjectSlug = z
  .string()
  .describe(
    "The project's slug. This will default to all projects you have access to. It is encouraged to specify this when possible.",
  );

export const ParamIssueShortId = z
  .string()
  .describe("The Issue ID. e.g. `PROJECT-1Z43`");

export const ParamPlatform = z
  .string()
  .describe(
    "The platform for the project (e.g., python, javascript, react, etc.)",
  );

export const ParamTransaction = z
  .string()
  .describe(
    "The transaction name (also known as the endpoint, or route name).",
  );

export const ParamQuery = z
  .string()
  .describe(
    `The search query to apply. Use the \`help(subject="query_syntax")\` tool to get more information about the query syntax rather than guessing.`,
  );

export const ParamRegionUrl = z
  .string()
  .describe("The region URL for the organization you're querying, if known.");
