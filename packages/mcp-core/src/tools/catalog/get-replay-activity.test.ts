import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer, replayDetailsFixture } from "@sentry/mcp-server-mocks";
import getReplayActivity from "./get-replay-activity.js";
import { getServerContext } from "../../test-setup.js";

const REPLAY_URL = `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`;
const SEGMENTS_URL = `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`;

function callTool(
  params: Record<string, unknown> = {},
  context = getServerContext(),
) {
  return getReplayActivity.handler(
    {
      organizationSlug: "sentry-mcp-evals",
      replayId: replayDetailsFixture.id,
      regionUrl: "https://us.sentry.io",
      grain: "standard",
      limit: 50,
      ...params,
    } as never,
    context,
  );
}

/** Pull the cursor out of a truncated result so paging can be followed. */
function cursorFrom(output: string): string {
  const match = output.match(/cursor='([^']+)'/);
  if (!match) {
    throw new Error(`expected a cursor in output:\n${output}`);
  }
  return match[1];
}

afterEach(() => {
  mswServer.resetHandlers();
});

describe("get_replay_activity", () => {
  it("returns the whole session when no window is given", async () => {
    const result = await callTool();

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f activity

      Window: whole session

      T+0.5s  navigation  Navigated to example.com/login
      T+12.4s  click  Clicked body > div#root > form#login > button#sign-in
      T+14.2s  navigation  Navigated to example.com/checkout
      T+3m 0.6s  click  Clicked body > div#root > main > button#complete-order
      T+3m 1.0s  network  Fetch POST example.com/api/checkout failed with 500
      T+3m 1.3s  console  Console error: TypeError: Cannot read properties of undefined (reading 'id')
      T+3m 8.4s  rage-click  Rage click on body > div#root > main > button#complete-order
      T+3m 41.7s  dead-click  Dead click — no response from body > div#root > main > a#download-receipt

      A click the page did not answer is usually explained by the element itself. Use the Sentry tool \`get_replay_dom\` to see the page structure at that moment:
      get_replay_dom(organizationSlug='sentry-mcp-evals', replayId='7e07485f-12f9-416b-8b14-26260799b51f', atMs=188400, rootNodeId=96)"
    `);
  });

  it("returns only signals inside the requested window", async () => {
    // The window suggested by get_replay_details for the fixture's error.
    const result = await callTool({ startMs: 176300, endMs: 186300 });

    expect(result).toContain("Window: T+2m 56.3s–T+3m 6.3s");
    expect(result).toContain(
      "Clicked body > div#root > main > button#complete-order",
    );
    expect(result).toContain(
      "Fetch POST example.com/api/checkout failed with 500",
    );
    expect(result).toContain("Console error: TypeError");
    // Outside the window on either side.
    expect(result).not.toContain("button#sign-in");
    expect(result).not.toContain("a#download-receipt");
  });

  it("treats window bounds as inclusive", async () => {
    const result = await callTool({ startMs: 181300, endMs: 181300 });

    expect(result).toContain("Console error: TypeError");
    expect(result).not.toContain("network");
  });

  it("rejects a window that ends before it starts", async () => {
    await expect(callTool({ startMs: 5000, endMs: 1000 })).rejects.toThrow(
      "`endMs` must be greater than or equal to `startMs`.",
    );
  });

  describe("grain", () => {
    it("rolls up one line per kind at digest grain", async () => {
      const result = await callTool({ grain: "digest" });

      expect(result).toContain("navigation ×2");
      expect(result).toContain("network ×1 (1 failed)");
      expect(result).toContain("console ×1 (1 failed)");
    });

    it("adds payload lines at detail grain", async () => {
      const result = await callTool({
        grain: "detail",
        kinds: ["network"],
      });

      // The SDK reported body sizes but did not capture the bodies
      // themselves, which is the common case since networkCaptureBodies is
      // opt-in. Saying so beats silence, which would imply we could have
      // retrieved them.
      expect(result).toContain("request body: 214 bytes <not captured>");
      expect(result).toContain("response body: 87 bytes <not captured>");
    });

    it("reports the rrweb node id a DOM read can root at", async () => {
      // The handoff to `get_replay_dom`: the id is stable within a recording
      // and reaches us on every click breadcrumb, but nothing else in this
      // output names it, so without this line "show me the DOM around what was
      // rage-clicked" has no handle to pass along.
      const result = await callTool({ grain: "detail", kinds: ["click"] });

      expect(result).toContain("nodeId: 96");
    });

    it("omits payload lines at standard grain", async () => {
      const result = await callTool({ kinds: ["network"] });

      expect(result).not.toContain("request body:");
    });
  });

  describe("redaction", () => {
    /** Serve a single fetch span with the given `data` payload. */
    function serveNetworkSpan(data: Record<string, unknown>) {
      mswServer.use(
        http.get(SEGMENTS_URL, () =>
          HttpResponse.json([
            [
              {
                type: 5,
                timestamp: 1744027201,
                data: {
                  tag: "performanceSpan",
                  payload: {
                    op: "resource.fetch",
                    description: "https://example.com/api/pay",
                    startTimestamp: 1744027201,
                    endTimestamp: 1744027201.4,
                    data,
                  },
                },
              },
            ],
          ]),
        ),
      );
    }

    it("distinguishes a value Relay scrubbed from one never captured", async () => {
      // Both are absent from the output, but for different reasons, and the
      // difference decides what the reader does next: enable
      // networkCaptureBodies, or relax a server-side scrubbing rule.
      serveNetworkSpan({
        method: "POST",
        statusCode: 500,
        request: { size: 64, body: "[Filtered]" },
        response: { size: 32 },
      });

      const result = await callTool({ grain: "detail", kinds: ["network"] });

      expect(result).toContain("request body: <redacted>");
      expect(result).toContain("response body: 32 bytes <not captured>");
    });

    it("never prints a body Relay scrubbed", async () => {
      serveNetworkSpan({
        method: "POST",
        statusCode: 500,
        request: { size: 64, body: "[Filtered]" },
      });

      const result = await callTool({ grain: "detail", kinds: ["network"] });

      expect(result).not.toContain("[Filtered]");
    });
  });

  describe("kind filtering", () => {
    it("returns only the requested kinds", async () => {
      const result = await callTool({ kinds: ["console", "network"] });

      expect(result).toContain("Console error: TypeError");
      expect(result).toContain("Fetch POST example.com/api/checkout");
      expect(result).not.toContain("Clicked ");
      expect(result).not.toContain("Navigated to");
    });

    it("distinguishes rage and dead clicks from ordinary clicks", async () => {
      const result = await callTool({ kinds: ["rage-click"] });

      expect(result).toContain("Rage click on");
      expect(result).not.toContain("Dead click");
      expect(result).not.toContain("Clicked body");
    });

    it("reports an empty result rather than pretending nothing happened", async () => {
      const result = await callTool({ kinds: ["feedback"] });

      expect(result).toContain("No signals matched.");
    });
  });

  describe("paging", () => {
    it("states truncation and returns a usable cursor", async () => {
      const result = await callTool({ limit: 3 });

      expect(result).toContain("Showing 1–3 of 8 matching signals");
      expect(result).toContain("cursor='");
    });

    it("continues from the cursor without repeating or skipping signals", async () => {
      const first = await callTool({ limit: 3 });
      const second = await callTool({ cursor: cursorFrom(first), limit: 3 });
      const third = await callTool({ cursor: cursorFrom(second), limit: 3 });

      expect(second).toContain("Showing 4–6 of 8");
      expect(third).toContain("T+3m 41.7s");
      // The last page is complete, so it offers no further cursor.
      expect(third).not.toContain("cursor='");
    });

    it("carries the window and kind filter through the cursor", async () => {
      // Each page re-reads the recording, so a cursor that did not encode the
      // query would silently continue a different one.
      const first = await callTool({
        kinds: ["click", "rage-click", "dead-click"],
        limit: 1,
      });
      const second = await callTool({ cursor: cursorFrom(first), limit: 1 });

      expect(second).toContain("kinds: click, rage-click, dead-click");
      expect(second).toContain("Showing 2–2 of 4");
      expect(second).not.toContain("Navigated to");
    });

    it("ignores window and kind arguments passed alongside a cursor", async () => {
      // Honouring both would silently change what the caller is paging through.
      const first = await callTool({ kinds: ["click"], limit: 1 });
      const second = await callTool({
        cursor: cursorFrom(first),
        kinds: ["network"],
        limit: 1,
      });

      expect(second).toContain("kinds: click");
      expect(second).not.toContain("Fetch POST");
    });

    it("rejects a malformed cursor", async () => {
      await expect(callTool({ cursor: "not-a-cursor" })).rejects.toThrow(
        "Invalid `cursor`",
      );
    });
  });

  describe("degradation", () => {
    it("reports an archived replay instead of an empty window", async () => {
      mswServer.use(
        http.get(REPLAY_URL, () =>
          HttpResponse.json({
            data: { ...replayDetailsFixture, is_archived: true },
          }),
        ),
      );

      const result = await callTool();

      expect(result).toContain("Recording is archived");
    });

    it("reports a replay with no recording segments", async () => {
      mswServer.use(
        http.get(REPLAY_URL, () =>
          HttpResponse.json({
            data: { ...replayDetailsFixture, count_segments: 0 },
          }),
        ),
      );

      const result = await callTool();

      expect(result).toContain("No recording segments are available");
    });

    it("rejects a replay outside the active project constraint", async () => {
      // The constrained project resolves to a different id than the replay's,
      // so the replay is out of scope for this session.
      mswServer.use(
        http.get(
          "https://us.sentry.io/api/0/projects/sentry-mcp-evals/frontend/",
          () =>
            HttpResponse.json({
              id: "9999999999999999",
              slug: "frontend",
              name: "frontend",
            }),
        ),
      );

      await expect(
        callTool(
          {},
          getServerContext({ constraints: { projectSlug: "frontend" } }),
        ),
      ).rejects.toThrow("outside the active project constraint");
    });
  });

  describe("structural read handoff", () => {
    it("prints a rooted get_replay_dom call after an unanswered click", async () => {
      // Without a printed call the third step of the chain is only reachable by
      // knowing it exists and searching the catalog. The map hands this tool its
      // next call the same way.
      const result = await callTool();

      expect(result).toContain(
        "get_replay_dom(organizationSlug='sentry-mcp-evals'",
      );
      // Rooted at the rage-clicked button, at the moment of the rage click.
      expect(result).toContain("atMs=188400");
      expect(result).toContain("rootNodeId=96");
    });

    it("does not suggest a structural read when nothing structural happened", async () => {
      // A suggestion on every response is one nobody reads. A failed request is
      // explained by its response, not by the DOM.
      const result = await callTool({ kinds: ["network", "console"] });

      expect(result).not.toContain("get_replay_dom");
    });

    it("stays silent when the DOM tool is not in this session", async () => {
      // Naming an unreachable tool sends the reader after something that cannot
      // be called.
      const result = await callTool(
        {},
        getServerContext({
          availableToolNames: new Set([
            "get_replay_activity",
            "get_replay_details",
          ]),
        }),
      );

      expect(result).not.toContain("get_replay_dom");
    });
  });

  describe("tool definition", () => {
    it("is gated like get_replay_details", async () => {
      expect(getReplayActivity.requiredScopes).toEqual([
        "org:read",
        "project:read",
        "event:read",
      ]);
      expect(getReplayActivity.requiredCapabilities).toEqual(["replays"]);
      expect(getReplayActivity.skills).toEqual(["inspect"]);
    });

    it("stays off the direct top-level surface", async () => {
      const { isDefaultTopLevelToolName } = await import("../surfaces.js");
      expect(isDefaultTopLevelToolName("get_replay_activity")).toBe(false);
    });

    it("is reachable through the catalog", async () => {
      const { default: catalog } = await import("./index.js");
      expect(catalog.get_replay_activity).toBe(getReplayActivity);
    });
  });
});
