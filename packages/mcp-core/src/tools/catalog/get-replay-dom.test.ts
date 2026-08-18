import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer, replayDetailsFixture } from "@sentry/mcp-server-mocks";
import getReplayDom from "./get-replay-dom.js";
import { getServerContext } from "../../test-setup.js";

const REPLAY_URL = `https://us.sentry.io/api/0/organizations/sentry-mcp-evals/replays/${replayDetailsFixture.id}/`;
const SEGMENTS_URL = `https://us.sentry.io/api/0/projects/sentry-mcp-evals/${replayDetailsFixture.project_id}/replays/${replayDetailsFixture.id}/recording-segments/`;

/**
 * Offsets into the fixture recording, in ms from the replay start.
 *
 * The checkout snapshot lands at T+3m 0.0s. The console error is at T+3m 1.3s,
 * and the error banner and disabled button arrive after it — so a read at the
 * error must not show either, and a read at the end must show both.
 */
const AT_LOGIN = 12_400;
const AT_CHECKOUT_ERROR = 181_300;
const AT_END = 200_000;

function callTool(
  params: Record<string, unknown> = {},
  context = getServerContext(),
) {
  return getReplayDom.handler(
    {
      organizationSlug: "sentry-mcp-evals",
      replayId: replayDetailsFixture.id,
      regionUrl: "https://us.sentry.io",
      atMs: AT_CHECKOUT_ERROR,
      lens: "interactive",
      maxDepth: 12,
      maxNodes: 200,
      ...params,
    } as never,
    context,
  );
}

afterEach(() => {
  mswServer.resetHandlers();
});

describe("get_replay_dom", () => {
  it("reconstructs the page as it stood at the requested moment", async () => {
    const result = await callTool({ atMs: AT_CHECKOUT_ERROR });

    expect(result).toMatchInlineSnapshot(`
      "# Replay 7e07485f-12f9-416b-8b14-26260799b51f DOM at T+3m 1.3s

      Reconstructed from the snapshot at T+3m 0.0s, applying 1 mutation.

      \`\`\`
      html  id=3
      └─ body  id=60
         └─ div#root  id=61
            └─ main  id=62
               ├─ form#checkout-form  id=80
               │  ├─ div.address-block  id=81
               │  │  ├─ input#unit  [value="***"]  [name=unit]  id=82
               │  │  └─ input#zip  [value="***"]  [name=zip]  id=83
               │  ├─ label  "Quantity"  id=84
               │  ├─ input#quantity  [value="3"]  [type=number]  [name=quantity]  id=90
               │  └─ button#complete-order  "Complete order"  [type=button]  id=96
               └─ a#download-receipt  "Download receipt"  [href=/receipts/latest]  id=118
      \`\`\`

      Showing interactive elements and their ancestors. Pass \`rootNodeId\` to focus a subtree, or \`lens: "full"\` for every element."
    `);
  });

  it("takes an input value from the input event, not the shipped attribute", async () => {
    // The quantity field ships with value="1" and is changed to "3" by a
    // `source: 5` event. A reconstruction that applied only `source: 0`
    // mutations would render "1" — plausible, authoritative-looking, and stale.
    const result = await callTool({ atMs: AT_CHECKOUT_ERROR });

    expect(result).toContain('input#quantity  [value="3"]');
    expect(result).not.toContain('input#quantity  [value="1"]');
  });

  it("does not show structure that arrives after the requested moment", async () => {
    // The error banner is added at T+3m 1.4s and the button is disabled at
    // T+3m 2.0s, both after the moment asked for. Including either would make
    // the tree describe a later page than the caller asked about.
    const atError = await callTool({ atMs: AT_CHECKOUT_ERROR, lens: "full" });

    expect(atError).not.toContain("order-error");
    expect(atError).not.toContain("[disabled]");

    const atEnd = await callTool({ atMs: AT_END, lens: "full" });

    expect(atEnd).toContain("div#order-error");
    expect(atEnd).toContain('"Payment failed. Please try again."');
    expect(atEnd).toContain("button#complete-order");
    expect(atEnd).toContain("[disabled]");
  });

  it("applies a text mutation to the element that carries it", async () => {
    // The button's label changes from "Complete order" to "Processing…" via a
    // text mutation against the child text node, not the button.
    const result = await callTool({ atMs: AT_END });

    expect(result).toContain('button#complete-order  "Processing…"');
  });

  it("uses the snapshot in effect at the moment, not the first one", async () => {
    // Segment 0 snapshots the login page; segment 1 re-snapshots checkout. A
    // read at the login click must get the login page, which also proves a
    // later snapshot is not merged into an earlier one.
    const result = await callTool({ atMs: AT_LOGIN });

    expect(result).toContain("form#login");
    expect(result).toContain("button#sign-in");
    expect(result).not.toContain("checkout-form");
  });

  describe("rooting", () => {
    it("renders only the named subtree", async () => {
      // Node 80 is the checkout form. The receipt link is a sibling of the
      // form, so it must not appear.
      const result = await callTool({
        atMs: AT_CHECKOUT_ERROR,
        rootNodeId: 80,
      });

      expect(result).toContain("form#checkout-form  id=80");
      expect(result).not.toContain("download-receipt");
      expect(result).not.toContain("div#root");
    });

    it("roots at a node id reported by a click signal", async () => {
      // 96 is the id `get_replay_activity` reports for the rage-clicked
      // button, which is the whole point of the handoff.
      const result = await callTool({
        atMs: AT_CHECKOUT_ERROR,
        rootNodeId: 96,
      });

      expect(result).toContain('button#complete-order  "Complete order"');
    });

    it("says so when the node does not exist at that moment", async () => {
      // 130 is the error banner, which does not exist yet at this offset.
      // Reporting an empty tree instead would read as "nothing was there".
      const result = await callTool({
        atMs: AT_CHECKOUT_ERROR,
        rootNodeId: 130,
      });

      expect(result).toContain("Node 130 does not exist in the DOM");
      expect(result).toContain(
        "check the offset of the signal the id came from",
      );
    });
  });

  describe("lenses", () => {
    it("drops inert containers under the interactive lens", async () => {
      const interactive = await callTool({ atMs: AT_END });

      // The h1 and the error banner are not interactive and have no
      // interactive descendants.
      expect(interactive).not.toContain("h1");
      expect(interactive).not.toContain("order-error");
    });

    it("keeps every element under the full lens", async () => {
      const full = await callTool({ atMs: AT_END, lens: "full" });

      expect(full).toContain("h1");
      expect(full).toContain("div#order-error");
    });

    it("reports hitting the node budget, and how to see more", async () => {
      const result = await callTool({
        atMs: AT_CHECKOUT_ERROR,
        lens: "full",
        maxNodes: 4,
      });

      expect(result).toContain("Stopped after 4 elements (`maxNodes`)");
      expect(result).toContain("raise `maxNodes`");
      expect(result).toContain("`rootNodeId`");
    });

    it("prunes a deep branch without dropping its siblings", async () => {
      // The bug this guards: depth truncation used to abort the whole walk, so
      // one deep branch hid every later sibling — on a real page `head` is
      // routinely deep enough to swallow `body` entirely.
      const result = await callTool({
        atMs: AT_CHECKOUT_ERROR,
        lens: "full",
        maxDepth: 2,
      });

      // `head` and `body` are both at depth 1, so both must appear even though
      // everything below them is pruned.
      expect(result).toContain("head");
      expect(result).toContain("body");
      expect(result).toContain("deeper than `maxDepth`");
      expect(result).toContain("not shown");
    });

    it("renders a deeply nested real-world page at the default depth", async () => {
      // The default was 12, which clipped a real Sentry page whose element tree
      // is 17 levels deep — hiding exactly the interactive elements the lens
      // exists to surface.
      const result = await callTool({ atMs: AT_CHECKOUT_ERROR });

      expect(result).not.toContain("deeper than `maxDepth`");
    });
  });

  describe("degradation", () => {
    it("refuses rather than returning a partial tree when the budget is hit", async () => {
      // A page large enough to trip the byte budget before the target moment
      // is reached. A tree built from a truncated mutation history looks
      // exactly like a complete one, so it must not be returned at all.
      const padding = "x".repeat(11 * 1024 * 1024);
      mswServer.use(
        http.get(SEGMENTS_URL, () =>
          HttpResponse.json([
            [
              {
                type: 5,
                timestamp: 1744027200000,
                data: {
                  tag: "breadcrumb",
                  payload: { category: "ui.click", message: padding },
                },
              },
            ],
          ]),
        ),
      );

      const result = await callTool({ atMs: AT_END });

      expect(result).toContain("Cannot reconstruct the DOM");
      expect(result).toContain("A partial tree is not returned");
      expect(result).toContain("An earlier `atMs`");
      expect(result).not.toContain("```");
    });

    it("says so when no snapshot exists at or before the moment", async () => {
      // A recording whose only snapshot is later than the moment asked for.
      mswServer.use(
        http.get(SEGMENTS_URL, () =>
          HttpResponse.json([
            [
              {
                type: 2,
                timestamp: 1744027400000,
                data: { node: { id: 1, type: 0, childNodes: [] } },
              },
            ],
          ]),
        ),
      );

      const result = await callTool({ atMs: 1_000 });

      expect(result).toContain("No full DOM snapshot appears at or before");
      expect(result).toContain("Try a later `atMs`");
    });

    it("reports when the recording ends before the requested moment", async () => {
      // Not an error, but the tree is the last state on record rather than the
      // state at the moment asked for, and those are different claims.
      const result = await callTool({ atMs: 600_000 });

      expect(result).toContain("The recording ends before T+10m 0.0s");
    });

    it("reports an archived replay", async () => {
      mswServer.use(
        http.get(REPLAY_URL, () =>
          HttpResponse.json({
            data: { ...replayDetailsFixture, is_archived: true },
          }),
        ),
      );

      const result = await callTool();

      expect(result).toContain("archived");
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

    it("refuses when the replay has no usable start time", async () => {
      // Offsets are relative to the replay's start; without one there is no way
      // to place `atMs` on the recording, and either end of the session would
      // answer a different question.
      mswServer.use(
        http.get(REPLAY_URL, () =>
          HttpResponse.json({
            data: { ...replayDetailsFixture, started_at: null },
          }),
        ),
      );

      const result = await callTool();

      expect(result).toContain("no usable start time");
    });

    it("rejects a replay outside the active project constraint", async () => {
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

  describe("tool definition", () => {
    it("is gated like the other replay tools", async () => {
      expect(getReplayDom.requiredScopes).toEqual([
        "org:read",
        "project:read",
        "event:read",
      ]);
      expect(getReplayDom.requiredCapabilities).toEqual(["replays"]);
      expect(getReplayDom.skills).toEqual(["inspect"]);
    });

    it("stays off the direct top-level surface", async () => {
      const { isDefaultTopLevelToolName } = await import("../surfaces.js");
      expect(isDefaultTopLevelToolName("get_replay_dom")).toBe(false);
    });

    it("is reachable through the catalog", async () => {
      const { default: catalog } = await import("./index.js");
      expect(catalog.get_replay_dom).toBe(getReplayDom);
    });
  });
});
