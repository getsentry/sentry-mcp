import { buildRouteMap } from "@stricli/core";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";

export const orgRoute = buildRouteMap({
  routes: {
    list: listCommand,
    get: getCommand,
  },
  docs: {
    brief: "Work with Sentry organizations",
    fullDescription: "List and manage Sentry organizations you have access to.",
    hideRoute: {},
  },
});
