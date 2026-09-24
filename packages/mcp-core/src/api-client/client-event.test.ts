import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testEvents } from "../internal/test-fixtures";
import { SentryApiService } from "./client";
import { ApiValidationError } from "./errors";

const request = {
  organizationSlug: "test-org",
  issueId: "123",
  eventId: "latest",
};

function respondWith(context: unknown, overrides = {}) {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/organizations/test-org/issues/123/events/latest/",
      () =>
        HttpResponse.json({
          ...testEvents.pythonException("Invalid value"),
          context,
          ...overrides,
        }),
    ),
  );
}

describe("getEventForIssue context validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { context: null, contextType: "null" },
    { context: ["private-extra-value"], contextType: "array" },
    { context: "private-extra-value", contextType: "string" },
    { context: 12345, contextType: "number" },
    { context: false, contextType: "boolean" },
  ])(
    "rejects $contextType and logs only its shape",
    async ({ context, contextType }) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      respondWith(context);
      const client = new SentryApiService({ accessToken: "test-token" });

      await expect(client.getEventForIssue(request)).rejects.toBeInstanceOf(
        ApiValidationError,
      );

      expect(log).toHaveBeenCalledTimes(1);
      const output = String(log.mock.calls[0][0]);
      const record = JSON.parse(output);
      expect(record.message).toBe("Event failed schema validation: error");
      expect(record.properties.contextType).toBe(contextType);
      expect(record.properties).not.toHaveProperty("context");
      expect(output).not.toContain("private-extra-value");
    },
  );

  it.each([
    { label: "missing", context: undefined },
    { label: "empty map", context: {} },
    {
      label: "map with arbitrary values",
      context: { array: [1, "two"], nested: { value: false }, nullable: null },
    },
  ])("preserves $label without logging a failure", async ({ context }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    respondWith(context);
    const client = new SentryApiService({ accessToken: "test-token" });

    const event = await client.getEventForIssue(request);
    expect(event.context).toEqual(context);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    { context: undefined, contextType: "undefined" },
    {
      context: { "private-extra-key": "private-extra-value" },
      contextType: "object",
    },
  ])(
    "reports $contextType when another field fails without exposing extra data",
    async ({ context, contextType }) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      respondWith(context, { title: null });
      const client = new SentryApiService({ accessToken: "test-token" });

      await expect(client.getEventForIssue(request)).rejects.toBeInstanceOf(
        ApiValidationError,
      );
      expect(log).toHaveBeenCalledTimes(1);
      const output = String(log.mock.calls[0][0]);
      expect(JSON.parse(output).properties.contextType).toBe(contextType);
      expect(output).not.toContain("private-extra-key");
      expect(output).not.toContain("private-extra-value");
    },
  );
});
