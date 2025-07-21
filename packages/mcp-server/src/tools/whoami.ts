import { z } from "zod";
import { defineTool } from "./utils/defineTool";
import { apiServiceFromContext } from "./utils/api-utils";
import type { ServerContext } from "../types";

export default defineTool({
  name: "whoami",
  description: [
    "Identify the authenticated user in Sentry.",
    "",
    "Use this tool when you need to:",
    "- Get the user's name and email address.",
  ].join("\n"),
  inputSchema: {},
  async handler(params, context: ServerContext) {
    // User data endpoints (like /auth/) should never use regionUrl
    // as they must always query the main API server, not region-specific servers
    const apiService = apiServiceFromContext(context);
    const user = await apiService.getAuthenticatedUser();
    const mdOutput = `You are authenticated as ${user.name} (${user.email}).\n\nYour Sentry User ID is ${user.id}.`;
    if (params.responseType === "json") {
      return {
        user,
      };
    }
    return mdOutput;
  },
});
