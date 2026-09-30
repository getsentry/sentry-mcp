/**
 * sentry feedback
 *
 * Search and inspect modern Sentry User Feedback.
 */

import { buildRouteMap } from "../../lib/route-map.js";
import { listCommand } from "./list.js";
import { viewCommand } from "./view.js";

export const feedbackRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
  },
  defaultCommand: "view",
  docs: {
    brief: "Search and inspect User Feedback",
    fullDescription:
      "Search and inspect modern User Feedback from your Sentry organization.\n\n" +
      "Commands:\n" +
      "  list  List and search feedback\n" +
      "  view  View feedback with its latest event context",
    hideRoute: {},
  },
});
