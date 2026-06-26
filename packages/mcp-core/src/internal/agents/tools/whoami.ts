import { z } from "zod";
import type { SentryApiService } from "../../../api-client";
import { agentTool } from "./utils";

export interface WhoamiResult {
  id: string | number;
  name: string | null;
  email: string;
}

/**
 * Get the current authenticated user's information from Sentry API
 */
export async function getCurrentUser(
  apiService: SentryApiService,
): Promise<WhoamiResult> {
  // API client throws ApiClientError/ApiServerError which wrapAgentToolExecute handles
  const user = await apiService.getAuthenticatedUser();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

/**
 * Create a tool for getting current user information
 * The tool is pre-bound with the API service configured for the appropriate region
 */
export function createWhoamiTool(options: { apiService: SentryApiService }) {
  const { apiService } = options;
  return agentTool({
    description: "Get the current authenticated user's information",
    parameters: z.object({}),
    execute: async () => {
      const user = await getCurrentUser(apiService);
      return `Current user: ${user.name || "Unknown"} (${user.email}, ID: ${user.id})`;
    },
  });
}
