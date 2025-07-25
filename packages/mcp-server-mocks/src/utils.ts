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
  const handlers = [
    // Default handlers for common Sentry API endpoints
    http.get(`${baseUrl}/api/0/organizations/:org/issues/`, () => {
      return HttpResponse.json({
        data: [],
        links: {
          previous: null,
          next: null,
        },
      });
    }),

    http.get(`${baseUrl}/api/0/organizations/:org/events/`, () => {
      return HttpResponse.json({
        data: [],
        meta: {
          fields: {},
        },
      });
    }),

    http.get(`${baseUrl}/api/0/users/me/`, () => {
      return HttpResponse.json({
        id: "123456",
        email: "test@example.com",
        name: "Test User",
      });
    }),

    // Dataset attributes for search_events agent
    http.get(`${baseUrl}/api/0/organizations/:org/events/meta/`, () => {
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
    http.get(`${baseUrl}/api/0/organizations/:org/issues/fields/`, () => {
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

    // Trace item attributes for spans/logs
    http.get(
      `${baseUrl}/api/0/organizations/:org/trace-items/attributes/`,
      ({ request }) => {
        const itemType = new URL(request.url).searchParams.get("type");

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

    // Tags for error events
    http.get(`${baseUrl}/api/0/organizations/:org/tags/`, () => {
      return HttpResponse.json([
        { key: "environment", name: "Environment" },
        { key: "release", name: "Release" },
        { key: "user", name: "User" },
        { key: "browser", name: "Browser" },
        { key: "os", name: "Operating System" },
      ]);
    }),
  ];

  const server = setupServer(...handlers);

  return {
    server,
    start: () => server.listen({ onUnhandledRequest: "bypass" }),
    stop: () => server.close(),
    reset: () => server.resetHandlers(),
  };
}
