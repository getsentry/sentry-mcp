import { buildRouteMap } from "@stricli/core";
import { listCommand } from "./list.js";

export const projectRoute = buildRouteMap({
  routes: {
    list: listCommand,
  },
  docs: {
    brief: "Work with Sentry projects",
    fullDescription: "List and manage Sentry projects in your organizations.",
    hideRoute: {},
  },
});
