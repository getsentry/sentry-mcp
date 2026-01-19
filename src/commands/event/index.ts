import { buildRouteMap } from "@stricli/core";
import { getCommand } from "./get.js";

export const eventRoute = buildRouteMap({
  routes: {
    get: getCommand,
  },
  docs: {
    brief: "View Sentry events",
    fullDescription:
      "View detailed event data from Sentry. " +
      "Use 'sentry event get <event-id>' to view a specific event.",
    hideRoute: {},
  },
});
