import { buildApplication, buildRouteMap } from "@stricli/core";
import { apiCommand } from "./commands/api.js";
import { authRoute } from "./commands/auth/index.js";
import { eventRoute } from "./commands/event/index.js";
import { issueRoute } from "./commands/issue/index.js";
import { orgRoute } from "./commands/org/index.js";
import { projectRoute } from "./commands/project/index.js";

const routes = buildRouteMap({
  routes: {
    auth: authRoute,
    org: orgRoute,
    project: projectRoute,
    issue: issueRoute,
    event: eventRoute,
    api: apiCommand,
  },
  docs: {
    brief: "A gh-like CLI for Sentry",
    fullDescription:
      "sentry is a command-line interface for interacting with Sentry. " +
      "It provides commands for authentication, viewing issues, and making API calls.",
    hideRoute: {},
  },
});

export const app = buildApplication(routes, {
  name: "sentry",
  versionInfo: {
    currentVersion: "0.1.0",
  },
});
