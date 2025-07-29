import { tool } from "ai";
import { z } from "zod";
import type { SentryApiService } from "../../../api-client";
import { wrapAgentToolExecute } from "./utils";

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
  const user = await apiService.getAuthenticatedUser();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

/**
 * Create a tool for getting current user information
 */
export function createWhoamiTool(apiService: SentryApiService) {
  return tool({
    description: "Get the current authenticated user's information",
    parameters: z.object({}),
    execute: wrapAgentToolExecute(async () => {
      const user = await getCurrentUser(apiService);
      return `Current user: ${user.name || "Unknown"} (${user.email}, ID: ${user.id})`;
    }),
  });
}
