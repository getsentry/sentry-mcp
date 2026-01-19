import { buildRouteMap } from "@stricli/core";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";

export const projectRoute = buildRouteMap({
  routes: {
    list: listCommand,
    get: getCommand,
  },
  docs: {
    brief: "Work with Sentry projects",
    fullDescription: "List and manage Sentry projects in your organizations.",
    hideRoute: {},
  },
});
