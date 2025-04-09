import type { z } from "zod";
import type {
  SentryErrorEntrySchema,
  SentryEventSchema,
} from "../lib/sentry-api";
import { SentryApiService, extractIssueId } from "../lib/sentry-api";
import type { ToolHandlers } from "./types";

const QUERY_SYNTAX = [
  "Search queries are constructed using a `key:value` pattern, with an optional raw search at the end. Each `key:value` pair is a `token` and the optional raw search is itself a single `token`. The `key:value` pair `tokens` are treated as issue or event properties. The optional raw search is treated as a single `token` and searches event titles/messages.",
  "",
  "For example:",
  "",
  "```",
  'is:resolved user.username:"Jane Doe" server:web-8 example error',
  "```",
  "",
  "In the example above, there are three keys (`is:`, `user.username:`, `server:`), but four tokens:",
  "",
  "- `is:resolved`",
  '- `user.username:"Jane Doe"`',
  "- `server:web-8`",
  "- `example error`",
  "",
  'The tokens `is:resolved` and `user.username:"Jane Doe"` are standard search tokens because both use reserved keywords. The token `server:web-8` is pointing to a custom tag sent by the Sentry SDK. See [Custom Tags](/concepts/search/searchable-properties/#custom-tags) for more information on how to set tags.',
  "",
  "The token `example error` is utilizing the optional raw search and is passed as part of the issue search query (which uses a CONTAINS match similar to SQL). When using the optional raw search, you can provide _one_ string, and the query uses that entire string.",
  "",
  "### Comparison Operators",
  "Sentry search supports the use of comparison operators:",
  "",
  "- greater than (`>`)",
  "- less than (`<`)",
  "- greater than or equal to (`>=`)",
  "- less than or equal to (`<=`)",
  "",
  "Typically, when you search using properties that are numbers or durations, you should use comparison operators rather than just a colon (`:`) to find exact matches, since an exact match isn't likely to exist.",
  "",
  "Here are some examples of valid comparison operator searches:",
  "",
  "- `event.timestamp:>2023-09-28T00:00:00-07:00`",
  "- `count_dead_clicks:<=10`",
  "- `transaction.duration:>5s`",
  "",
  "### Using `OR` and `AND`",
  "",
  "Use `OR` and `AND` between tokens, and use parentheses `()` to group conditions. `AND` can also be used between non-aggregates and aggregates. However, `OR` cannot.",
  "",
  "- Non-aggregates filter data based on specific tags or attributes. For example, `user.username:jane` is a non-aggregate field.",
  "- Aggregates filter data on numerical scales. For example, `count()` is an aggregate function and `count():>100` is an aggregate filter.",
  "",
  "Some examples of using the `OR` condition:",
  "",
  "```",
  "# a valid `OR` query",
  "browser:Chrome OR browser:Opera",
  "```",
  "",
  "# an invalid `OR` query",
  "user.username:janedoe OR count():>100",
  "```",
  "",
  'Also, the queries prioritize `AND` before `OR`. For example, "x `AND` y `OR` z" is the same as "(x `AND` y) `OR` z". Parentheses can be used to change the grouping. For example, "x `AND` (y `OR` z)".',
  "",
  "### Multiple Values on the Same Key",
  "",
  'You can search multiple values for the same key by putting the values in a list. For example, "x:[value1, value2]" will find the the same results as "x:value1 `OR` x:value2". When you do this, the search returns issues/events that match any search term.',
  "",
  "An example of searching on the same key with a list of values:",
  "",
  "```",
  "release:[12.0, 13.0]",
  "```",
  "",
  "You can't use wildcards with this type of search.",
  "",
  "### Exclusion",
  "",
  "By default, search terms use the `AND` operator; that is, they return the intersection of issues/events that match all search terms.",
  "",
  "To change this, you can use the negation operator `!` to _exclude_ a search parameter.",
  "",
  "```",
  "is:unresolved !user.email:example@customer.com",
  "```",
  "",
  "In the example above, the search query returns all Issues that are unresolved _and_ have not affected the user with the email address `example@customer.com`.",
  "",
  "### Wildcards",
  "",
  "Search supports the wildcard operator `*` as a placeholder for specific characters and strings.",
  "",
  "```",
  'browser:"Safari 11*"',
  "```",
  "",
  'In the example above, the search query will match on `browser` values like `"Safari 11.0.2"`, `"Safari 11.0.3"`, etc.',
  "",
  "You may also combine operators like so:",
  "",
  "```",
  '!message:"*Timeout"',
  "```",
  "",
  "In the above example, the search query returns results which do not have message values like `ConnectionTimeout`, `ReadTimeout`, etc.",
].join("\n");

function formatEventOutput(event: z.infer<typeof SentryEventSchema>) {
  let output = "";
  for (const entry of event.entries) {
    if (entry.type === "exception") {
      const data = entry.data as z.infer<typeof SentryErrorEntrySchema>;
      const firstError = data.value ?? data.values[0];
      if (!firstError) {
        continue;
      }
      output += `**Error:**\n${"```"}\n${firstError.type}: ${
        firstError.value
      }\n${"```"}\n\n`;
      if (!firstError.stacktrace || !firstError.stacktrace.frames) {
        continue;
      }
      output += `**Stacktrace:**\n${"```"}\n${firstError.stacktrace.frames
        .map((frame) => {
          const context = frame.context?.length
            ? `:${frame.context
                .filter(([lineno, _]) => lineno === frame.lineNo)
                .map(([_, code]) => `\n${code}`)
                .join("")}`
            : "";

          return `in "${frame.filename || frame.module}"${
            frame.lineNo ? ` at line ${frame.lineNo}` : ""
          }${context}`;
        })
        .join("\n")}\n${"```"}\n\n`;
    }
  }
  return output;
}

export const TOOL_HANDLERS = {
  list_organizations: async (context) => {
    const apiService = new SentryApiService(context.accessToken);
    const organizations = await apiService.listOrganizations();

    let output = "# Organizations\n\n";
    output += organizations.map((org) => `- ${org.slug}\n`).join("");

    return output;
  },
  list_teams: async (context, { organizationSlug }) => {
    const apiService = new SentryApiService(context.accessToken);

    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }

    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }

    const teams = await apiService.listTeams(organizationSlug);

    let output = `# Teams in **${organizationSlug}**\n\n`;
    output += teams.map((team) => `- ${team.slug}\n`).join("");

    return output;
  },
  list_projects: async (context, { organizationSlug }) => {
    const apiService = new SentryApiService(context.accessToken);

    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }

    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }

    const projects = await apiService.listProjects(organizationSlug);

    let output = `# Projects in **${organizationSlug}**\n\n`;
    output += projects.map((project) => `- ${project.slug}\n`).join("");

    return output;
  },
  get_error_details: async (
    context,
    { issueId, issueUrl, organizationSlug },
  ) => {
    const apiService = new SentryApiService(context.accessToken);

    if (issueUrl) {
      const resolved = extractIssueId(issueUrl);
      if (!resolved) {
        throw new Error(
          "Invalid Sentry issue URL. Path should contain '/issues/{issue_id}'",
        );
      }
      organizationSlug = resolved.organizationSlug;
      issueId = resolved.issueId;
    } else if (!issueId) {
      throw new Error("Either issueId or issueUrl must be provided");
    }

    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }

    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }

    const event = await apiService.getLatestEventForIssue({
      organizationSlug,
      issueId: issueId,
    });

    let output = `# ${issueId}: ${event.title}\n\n`;
    output += `**Issue ID**:\n${issueId}\n`;
    if (event.message) output += `**Message**:\n${event.message}\n`;
    if (event.culprit) output += `**Culprit**:\n${event.culprit}\n`;
    output += `**Occurred At**:\n${new Date(
      event.dateCreated,
    ).toISOString()}\n\n`;

    output += formatEventOutput(event);

    output += "# Using this information\n\n";
    output += `- You can reference the IssueID in commit messages (e.g. \`Fixes ${issueId}\`) to automatically close the issue when the commit is merged.\n`;
    output +=
      "- The stacktrace includes both first-party application code as well as third-party code, its important to triage to first-party code.\n";

    return output;
  },

  search_errors: async (
    context,
    { filename, query, sortBy, organizationSlug },
  ) => {
    const apiService = new SentryApiService(context.accessToken);

    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }

    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }

    const eventList = await apiService.searchErrors({
      organizationSlug,
      filename,
      query,
      sortBy,
    });

    let output = `# Search Results\n\n`;
    if (query) output += `These errors match the query \`${query}\`\n`;
    if (filename)
      output += `These errors are limited to the file suffix \`${filename}\`\n`;
    output += "\n";

    if (eventList.length === 0) {
      output += `No results found\n\n`;
      output += `We searched within the ${organizationSlug} organization.\n\n`;
      output += `You may want to consult the \`help\` tool if you think your search syntax might be wrong.\n`;
      return output;
    }

    for (const eventSummary of eventList) {
      output += `## ${eventSummary.issue}: ${eventSummary.title}\n\n`;
      output += `- **Issue ID**: ${eventSummary.issue}\n`;
      output += `- **Project**: ${eventSummary.project}\n`;
      output += `- **Last Seen**: ${eventSummary["last_seen()"]}\n`;
      output += `- **Occurrences**: ${eventSummary["count()"]}\n\n`;
    }

    output += "# Using this information\n\n";
    output += `- You can reference the Issue ID in commit messages (e.g. \`Fixes ${eventList[0].issue}\`) to automatically close the issue when the commit is merged.\n`;
    output += `- You can get more details about this error by using the "get_error_details" tool.\n`;

    return output;
  },

  create_team: async (context, { organizationSlug, name }) => {
    const apiService = new SentryApiService(context.accessToken);

    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }

    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }

    const team = await apiService.createTeam({
      organizationSlug,
      name,
    });

    let output = "# New Team\n\n";
    output += `- **ID**: ${team.id}\n`;
    output += `- **Slug**: ${team.slug}\n`;
    output += `- **Name**: ${team.name}\n`;

    output += "# Using this information\n\n";
    output += `- You should always inform the user of the Team Slug value.\n`;
    return output;
  },

  create_project: async (
    context,
    { organizationSlug, teamSlug, name, platform },
  ) => {
    const apiService = new SentryApiService(context.accessToken);

    if (!organizationSlug && context.organizationSlug) {
      organizationSlug = context.organizationSlug;
    }

    if (!organizationSlug) {
      throw new Error("Organization slug is required");
    }

    const [project, clientKey] = await apiService.createProject({
      organizationSlug,
      teamSlug,
      name,
      platform,
    });

    let output = "# New Project\n\n";
    output += `- **ID**: ${project.id}\n`;
    output += `- **Slug**: ${project.slug}\n`;
    output += `- **Name**: ${project.name}\n`;

    if (clientKey) {
      output += `- **SENTRY_DSN**: ${clientKey?.dsn.public}\n\n`;
    } else {
      output += "- **SENTRY_DSN**: There was an error fetching this value.\n\n";
    }

    output += "# Using this information\n\n";
    output += `- You can reference the **SENTRY_DSN** value to initialize Sentry's SDKs.\n`;
    output += `- You should always inform the user of the **SENTRY_DSN** and Project Slug values.\n`;

    return output;
  },

  help: async (context, { subject }) => {
    if (subject === "query_syntax") {
      return QUERY_SYNTAX;
    }

    return "Unknown subject";
  },
} satisfies ToolHandlers;
