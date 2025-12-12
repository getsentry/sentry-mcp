import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const orgRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "Work with Sentry organizations",
    fullDescription: "List and manage Sentry organizations you have access to.",
    hideRoute: {},
  },
});
