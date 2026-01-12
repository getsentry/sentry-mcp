import { buildRouteMap } from "@stricli/core";
import { loginCommand } from "./login.js";
import { logoutCommand } from "./logout.js";
import { statusCommand } from "./status.js";

export const authRoute = buildRouteMap({
  routes: {
    login: loginCommand,
    logout: logoutCommand,
    status: statusCommand,
  },
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Manage authentication with Sentry. Use 'sentry auth login' to authenticate, " +
      "'sentry auth logout' to remove credentials, and 'sentry auth status' to check your authentication status.",
    hideRoute: {},
  },
});
