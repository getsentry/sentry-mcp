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
  ];

  const server = setupServer(...handlers);

  return {
    server,
    start: () => server.listen({ onUnhandledRequest: "bypass" }),
    stop: () => server.close(),
    reset: () => server.resetHandlers(),
  };
}
