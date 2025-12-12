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
      "Manage authentication with Sentry. Use 'sry auth login' to authenticate, " +
      "'sry auth logout' to remove credentials, and 'sry auth status' to check your authentication status.",
    hideRoute: {},
  },
});
