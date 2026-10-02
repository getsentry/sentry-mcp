/**
 * sentry feedback
 *
 * Search, inspect, and manage modern Sentry User Feedback.
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { listCommand } from "./list.js";
import { resolveCommand } from "./resolve.js";
import { unresolveCommand } from "./unresolve.js";
import { viewCommand } from "./view.js";

export const feedbackRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
    resolve: resolveCommand,
    unresolve: unresolveCommand,
  },
  aliases: { reopen: "unresolve" },
  defaultCommand: "view",
  docs: {
    brief: "Manage User Feedback",
    fullDescription:
      "Search, inspect, and manage modern User Feedback from your Sentry organization.\n\n" +
      "Commands:\n" +
      "  list       List and search feedback\n" +
      "  view       View feedback with its latest event context\n" +
      "  resolve    Mark feedback as resolved\n" +
      "  unresolve  Reopen resolved feedback (alias: reopen)",
    hideRoute: {},
  },
});
