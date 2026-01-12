import { buildRouteMap } from "@stricli/core";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";

export const issueRoute = buildRouteMap({
  routes: {
    list: listCommand,
    get: getCommand,
  },
  docs: {
    brief: "Manage Sentry issues",
    fullDescription:
      "View and manage issues from your Sentry projects. " +
      "Use 'sentry issue list' to list issues and 'sentry issue get <id>' to view issue details.",
    hideRoute: {},
  },
});
