import { Hono } from "hono";
import type { Env } from "../types";
import { logError } from "@sentry/mcp-server/logging";
import { z } from "zod";
import type { RateLimitResult } from "../types/chat";
import type { AutoRagSearchResponse } from "@cloudflare/workers-types";

// Request schema matching the MCP tool parameters
const SearchRequestSchema = z.object({
  query: z.string().trim().min(1, "Query is required"),
  maxResults: z.number().int().min(1).max(10).default(10).optional(),
});

interface SearchResponse {
  results: Array<{
    id: string;
    url: string;
    snippet: string;
    relevance: number;
  }>;
  query: string;
  error?: string;
}

export default new Hono<{ Bindings: Env }>().post("/", async (c) => {
  try {
    // Get client IP address from Cloudflare header
    const clientIP = c.req.header("CF-Connecting-IP") || "unknown";

    // Rate limiting check - use client IP as the key
    // Note: Rate limiting bindings are "unsafe" (beta) and may not be available in development
    // so we check if the binding exists before using it
    // https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
    if (c.env.SEARCH_RATE_LIMITER) {
      try {
        // Hash the IP for privacy and consistent key format
        const encoder = new TextEncoder();
        const data = encoder.encode(clientIP);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const rateLimitKey = `search:ip:${hashHex.substring(0, 16)}`; // Use first 16 chars of hash

        const { success }: RateLimitResult =
          await c.env.SEARCH_RATE_LIMITER.limit({
            key: rateLimitKey,
          });
        if (!success) {
          return c.json(
            {
              error:
                "Rate limit exceeded. You can perform up to 20 documentation searches per minute. Please wait before searching again.",
              name: "RATE_LIMIT_EXCEEDED",
            },
            429,
          );
        }
      } catch (error) {
        const eventId = logError(error);
        return c.json(
          {
            error: "There was an error communicating with the rate limiter.",
            name: "RATE_LIMITER_ERROR",
            eventId,
          },
          500,
        );
      }
    }

    // Parse and validate request body
    const body = await c.req.json();
    const validationResult = SearchRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return c.json(
        {
          error: "Invalid request",
          details: validationResult.error.errors,
        },
        400,
      );
    }

    const { query, maxResults = 10 } = validationResult.data;

    // Check if AI binding is available
    if (!c.env.AI) {
      return c.json(
        {
          error: "AI service not available",
          name: "AI_SERVICE_UNAVAILABLE",
        },
        503,
      );
    }

    // Initialize response object
    let response: SearchResponse;

    try {
      const autoragId = c.env.AUTORAG_INDEX_NAME || "sentry-docs";
      const searchResult = await c.env.AI.autorag(autoragId).search({
        query,
        max_num_results: maxResults,
      });

      // Process search results - handle the actual response format from Cloudflare AI
      const searchData = searchResult as AutoRagSearchResponse;

      response = {
        query,
        results:
          searchData.data?.map((result) => {
            // Extract text from content array
            const text = result.content?.[0]?.text || "";

            // Get filename from result - ensure it's a string
            const rawFilename =
              result.filename || result.attributes?.filename || "";
            const filename =
              typeof rawFilename === "string"
                ? rawFilename
                : String(rawFilename);

            // Build URL from filename - remove .md extension
            const urlPath = filename.replace(/\.md$/, "");
            const url = urlPath ? `https://docs.sentry.io/${urlPath}` : "";

            return {
              id: filename,
              url: url,
              snippet: text,
              relevance: result.score || 0,
            };
          }) || [],
      };
    } catch (error) {
      logError(error);
      response = {
        query,
        results: [],
        error: "Failed to search documentation. Please try again later.",
      };
    }

    return c.json(response);
  } catch (error) {
    logError(error);
    return c.json(
      {
        error: "Internal server error",
        name: "INTERNAL_ERROR",
      },
      500,
    );
  }
});
