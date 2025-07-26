import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import type { SetupServer } from "msw/node";

interface MockApiService {
  server: SetupServer;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function setupMockServer(handlers: Array<any> = []): SetupServer {
  return setupServer(...handlers);
}

export function createMockApiService(
  baseUrl = "https://us.sentry.io",
): MockApiService {
  // Create handlers for multiple possible base URLs
  const baseUrls = [baseUrl, "https://sentry.io"];
  const handlers = baseUrls.flatMap((url) => [
    // Default handlers for common Sentry API endpoints
    http.get(`${url}/api/0/organizations/:org/issues/`, () => {
      return HttpResponse.json({
        data: [],
        links: {
          previous: null,
          next: null,
        },
      });
    }),

    http.get(`${url}/api/0/organizations/:org/events/`, () => {
      return HttpResponse.json({
        data: [],
        meta: {
          fields: {},
        },
      });
    }),

    // Auth endpoint (whoami)
    http.get(`${url}/api/0/auth/`, () => {
      return HttpResponse.json({
        id: "123456",
        email: "test@example.com",
        name: "Test User",
        username: "testuser",
        avatarUrl: "https://example.com/avatar.jpg",
        dateJoined: "2024-01-01T00:00:00Z",
        isActive: true,
        isManaged: false,
        isStaff: false,
        isSuperuser: false,
        lastLogin: "2024-12-01T00:00:00Z",
        has2fa: false,
        hasPasswordAuth: true,
        emails: [
          {
            id: "1",
            email: "test@example.com",
            is_verified: true,
          },
        ],
      });
    }),

    // Dataset attributes for search_events agent
    http.get(`${url}/api/0/organizations/:org/events/meta/`, () => {
      return HttpResponse.json({
        fields: {
          project: { type: "string" },
          timestamp: { type: "datetime" },
          "event.type": { type: "string" },
          message: { type: "string" },
          level: { type: "string" },
          transaction: { type: "string" },
          "user.email": { type: "string" },
          "tags[environment]": { type: "string" },
          "error.type": { type: "string" },
          "stack.function": { type: "string" },
        },
      });
    }),

    // Issue fields for search_issues agent
    http.get(`${url}/api/0/organizations/:org/issues/fields/`, () => {
      return HttpResponse.json({
        fields: [
          { key: "status", name: "Status", type: "choice" },
          { key: "assignedTo", name: "Assigned To", type: "user" },
          { key: "firstSeen", name: "First Seen", type: "datetime" },
          { key: "lastSeen", name: "Last Seen", type: "datetime" },
          { key: "level", name: "Level", type: "choice" },
          { key: "project", name: "Project", type: "project" },
          { key: "is", name: "Status", type: "status" },
          { key: "has", name: "Has", type: "has" },
        ],
      });
    }),

    // Trace item attributes for spans/logs - with string type
    http.get(
      `${url}/api/0/organizations/:org/trace-items/attributes/`,
      ({ request }) => {
        const params = new URL(request.url).searchParams;
        const itemType = params.get("itemType") || params.get("type");
        const attributeType =
          params.get("attributeType") || params.get("data_type");

        // Handle string type attributes
        if (attributeType === "string") {
          if (itemType === "spans") {
            return HttpResponse.json([
              { key: "span.op", name: "Operation" },
              { key: "span.description", name: "Description" },
              { key: "mcp.tool.name", name: "MCP Tool Name" },
              { key: "gen_ai.request.model", name: "AI Model" },
              { key: "transaction", name: "Transaction" },
              { key: "environment", name: "Environment" },
              { key: "custom.payment.processor", name: "Payment Processor" },
            ]);
          }
          if (itemType === "logs") {
            return HttpResponse.json([
              { key: "log.level", name: "Log Level" },
              { key: "log.message", name: "Log Message" },
              { key: "environment", name: "Environment" },
              { key: "custom.payment.processor", name: "Payment Processor" },
            ]);
          }
        }

        // Handle number type attributes
        if (attributeType === "number") {
          if (itemType === "spans") {
            return HttpResponse.json([
              { key: "span.duration", name: "Duration" },
              { key: "gen_ai.usage.input_tokens", name: "Input Tokens" },
              { key: "gen_ai.usage.output_tokens", name: "Output Tokens" },
              { key: "gen_ai.usage.total_tokens", name: "Total Tokens" },
              { key: "gen_ai.usage.prompt_tokens", name: "Prompt Tokens" },
              { key: "custom.db.pool_size", name: "Database Pool Size" },
            ]);
          }
          return HttpResponse.json([]);
        }

        // Default response with type included (when no dataType specified)
        if (itemType === "spans") {
          return HttpResponse.json([
            { key: "span.op", name: "Operation", type: "string" },
            { key: "span.duration", name: "Duration", type: "number" },
            { key: "span.description", name: "Description", type: "string" },
            { key: "mcp.tool.name", name: "MCP Tool Name", type: "string" },
            { key: "gen_ai.request.model", name: "AI Model", type: "string" },
          ]);
        }
        if (itemType === "logs") {
          return HttpResponse.json([
            { key: "log.level", name: "Log Level", type: "string" },
            { key: "log.message", name: "Log Message", type: "string" },
          ]);
        }

        return HttpResponse.json([]);
      },
    ),

    // Tags for error events (including custom fields)
    http.get(`${url}/api/0/organizations/:org/tags/`, ({ request }) => {
      const url = new URL(request.url);
      const dataset = url.searchParams.get("dataset");

      // Base tags that are always present
      const baseTags = [
        { key: "environment", name: "Environment", totalValues: 10 },
        { key: "release", name: "Release", totalValues: 5 },
        { key: "user", name: "User", totalValues: 100 },
        { key: "browser", name: "Browser", totalValues: 20 },
        { key: "os", name: "Operating System", totalValues: 15 },
      ];

      // Add dataset-specific and custom tags
      if (dataset === "search_issues") {
        return HttpResponse.json([
          ...baseTags,
          {
            key: "custom.payment.failed",
            name: "Payment Failed",
            totalValues: 50,
          },
          {
            key: "kafka.consumer.group",
            name: "Kafka Consumer Group",
            totalValues: 25,
          },
        ]);
      }

      // For events/errors dataset
      return HttpResponse.json([
        ...baseTags,
        {
          key: "custom.payment.processor",
          name: "Payment Processor",
          totalValues: 30,
        },
        {
          key: "custom.db.pool_size",
          name: "Database Pool Size",
          totalValues: 15,
        },
      ]);
    }),
  ]);

  const server = setupServer(...handlers);

  return {
    server,
    start: () => server.listen({ onUnhandledRequest: "bypass" }),
    stop: () => server.close(),
    reset: () => server.resetHandlers(),
  };
}
