import { describe, it, expect } from "vitest";
import {
  formatSpanDisplayName,
  renderSpanTree,
  getAllSpansFlattened,
  selectInterestingSpans,
  buildFullSpanTree,
  type SelectedSpan,
} from "./trace-rendering";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(overrides: Partial<SelectedSpan> = {}): SelectedSpan {
  return {
    event_id: "aaaaaaaabbbbccccddddeeeeffffaaaa",
    op: "http.client",
    name: null,
    description: "GET /api/test",
    duration: 100,
    is_transaction: false,
    children: [],
    level: 0,
    ...overrides,
  };
}

/** Minimal raw span matching the shape returned by the Sentry trace API. */
function makeRawSpan(overrides: Record<string, unknown> = {}): any {
  return {
    event_id: "aaaaaaaabbbbccccddddeeeeffffaaaa",
    op: "http.client",
    description: "GET /api/test",
    duration: 100,
    is_transaction: false,
    children: [],
    errors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatSpanDisplayName
// ---------------------------------------------------------------------------

describe("formatSpanDisplayName", () => {
  it("returns 'trace' for trace-op spans", () => {
    expect(formatSpanDisplayName(makeSpan({ op: "trace" }))).toBe("trace");
  });

  it("prefers span.name when present", () => {
    expect(
      formatSpanDisplayName(
        makeSpan({ name: "my-span", description: "fallback" }),
      ),
    ).toBe("my-span");
  });

  it("trims whitespace from span.name", () => {
    expect(formatSpanDisplayName(makeSpan({ name: "  padded  " }))).toBe(
      "padded",
    );
  });

  it("falls back to description when name is null", () => {
    expect(
      formatSpanDisplayName(makeSpan({ name: null, description: "desc" })),
    ).toBe("desc");
  });

  it("falls back to description when name is empty string", () => {
    expect(
      formatSpanDisplayName(makeSpan({ name: "  ", description: "desc" })),
    ).toBe("desc");
  });

  it("returns 'unnamed' when both name and description are missing", () => {
    expect(
      formatSpanDisplayName(makeSpan({ name: null, description: "" })),
    ).toBe("unnamed");
  });
});

// ---------------------------------------------------------------------------
// renderSpanTree
// ---------------------------------------------------------------------------

describe("renderSpanTree", () => {
  it("renders a single root span", () => {
    const span = makeSpan({ event_id: "aabbccdd11223344" });
    const lines = renderSpanTree([span]);
    expect(lines).toEqual(["GET /api/test [aabbccdd · http.client · 100ms]"]);
  });

  it("renders a trace root without duration", () => {
    const root = makeSpan({
      event_id: "aabbccdd11223344",
      op: "trace",
      duration: 0,
    });
    const lines = renderSpanTree([root]);
    expect(lines).toEqual(["trace [aabbccdd]"]);
  });

  it("omits op display for 'default' op", () => {
    const span = makeSpan({
      event_id: "aabbccdd11223344",
      op: "default",
      duration: 50,
    });
    const lines = renderSpanTree([span]);
    expect(lines).toEqual(["GET /api/test [aabbccdd · 50ms]"]);
  });

  it("renders parent-child hierarchy with box-drawing characters", () => {
    const child1 = makeSpan({
      event_id: "child111aaaabbbb",
      description: "child-1",
      duration: 30,
    });
    const child2 = makeSpan({
      event_id: "child222aaaabbbb",
      description: "child-2",
      duration: 20,
    });
    const root = makeSpan({
      event_id: "root0000aaaabbbb",
      op: "trace",
      children: [child1, child2],
    });

    const lines = renderSpanTree([root]);
    expect(lines).toMatchInlineSnapshot(`
      [
        "trace [root0000]",
        "   ├─ child-1 [child111 · http.client · 30ms]",
        "   └─ child-2 [child222 · http.client · 20ms]",
      ]
    `);
  });

  it("renders deeply nested spans with correct indentation", () => {
    const grandchild = makeSpan({
      event_id: "grand000aaaabbbb",
      description: "grandchild",
      duration: 5,
    });
    const child = makeSpan({
      event_id: "child000aaaabbbb",
      description: "child",
      duration: 50,
      children: [grandchild],
    });
    const root = makeSpan({
      event_id: "root0000aaaabbbb",
      op: "trace",
      children: [child],
    });

    const lines = renderSpanTree([root]);
    expect(lines).toMatchInlineSnapshot(`
      [
        "trace [root0000]",
        "   └─ child [child000 · http.client · 50ms]",
        "      └─ grandchild [grand000 · http.client · 5ms]",
      ]
    `);
  });

  it("renders multiple root spans", () => {
    const root1 = makeSpan({
      event_id: "root1111aaaabbbb",
      description: "first",
      duration: 100,
    });
    const root2 = makeSpan({
      event_id: "root2222aaaabbbb",
      description: "second",
      duration: 200,
    });
    const lines = renderSpanTree([root1, root2]);
    expect(lines).toMatchInlineSnapshot(`
      [
        "first [root1111 · http.client · 100ms]",
        "second [root2222 · http.client · 200ms]",
      ]
    `);
  });

  it("shows 'unknown' for zero-duration non-trace spans", () => {
    const span = makeSpan({
      event_id: "aabbccdd11223344",
      duration: 0,
    });
    const lines = renderSpanTree([span]);
    expect(lines).toEqual(["GET /api/test [aabbccdd · http.client · unknown]"]);
  });

  it("returns empty array for empty input", () => {
    expect(renderSpanTree([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAllSpansFlattened
// ---------------------------------------------------------------------------

describe("getAllSpansFlattened", () => {
  it("flattens a nested span tree", () => {
    const grandchild = makeRawSpan({
      event_id: "grandchild",
      description: "gc",
    });
    const child = makeRawSpan({
      event_id: "child",
      description: "c",
      children: [grandchild],
    });
    const root = makeRawSpan({
      event_id: "root",
      description: "r",
      children: [child],
    });

    const result = getAllSpansFlattened([root]);
    expect(result.map((s: any) => s.event_id)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });

  it("filters out non-span items (issues)", () => {
    const span = makeRawSpan({ event_id: "span1" });
    const issue = {
      id: 123,
      issue_id: 123,
      title: "Error",
      type: "error",
    };

    const result = getAllSpansFlattened([span, issue as any]);
    expect(result).toHaveLength(1);
    expect(result[0].event_id).toBe("span1");
  });

  it("returns empty array for empty input", () => {
    expect(getAllSpansFlattened([])).toEqual([]);
  });

  it("handles items without children array", () => {
    const noChildren = { event_id: "x", duration: 10 };
    expect(getAllSpansFlattened([noChildren as any])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectInterestingSpans
// ---------------------------------------------------------------------------

describe("selectInterestingSpans", () => {
  const traceId = "aaaaaaaabbbbbbbbccccccccdddddddd";

  it("wraps results in a fake trace root", () => {
    const result = selectInterestingSpans([], traceId);
    expect(result).toHaveLength(1);
    expect(result[0].op).toBe("trace");
    expect(result[0].event_id).toBe(traceId);
    expect(result[0].children).toEqual([]);
  });

  it("includes root-level spans regardless of duration", () => {
    const shortSpan = makeRawSpan({
      event_id: "short000aaaabbbb",
      duration: 1, // below MINIMUM_DURATION_THRESHOLD_MS
    });

    const result = selectInterestingSpans([shortSpan], traceId);
    const root = result[0];
    expect(root.children).toHaveLength(1);
    expect(root.children[0].event_id).toBe("short000aaaabbbb");
  });

  it("includes transactions", () => {
    const txn = makeRawSpan({
      event_id: "txn00000aaaabbbb",
      is_transaction: true,
      duration: 500,
      children: [],
    });

    const result = selectInterestingSpans([txn], traceId);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].is_transaction).toBe(true);
  });

  it("filters out non-span items from mixed arrays", () => {
    const span = makeRawSpan({
      event_id: "span0000aaaabbbb",
      duration: 100,
    });
    const issue = {
      id: 123,
      issue_id: 123,
      title: "Error",
      type: "error",
      timestamp: 123,
    };

    const result = selectInterestingSpans([span, issue as any], traceId);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].event_id).toBe("span0000aaaabbbb");
  });

  it("respects maxSpans limit", () => {
    const spans = Array.from({ length: 30 }, (_, i) =>
      makeRawSpan({
        event_id: `span${String(i).padStart(4, "0")}aaaabbbb`,
        duration: 100 + i,
      }),
    );

    const result = selectInterestingSpans(spans, traceId, 5);
    const root = result[0];
    // maxSpans=5, and we only take top 5 roots by duration
    expect(root.children.length).toBeLessThanOrEqual(5);
  });

  it("sorts roots by duration descending", () => {
    const slow = makeRawSpan({
      event_id: "slow0000aaaabbbb",
      duration: 1000,
    });
    const fast = makeRawSpan({
      event_id: "fast0000aaaabbbb",
      duration: 50,
    });

    const result = selectInterestingSpans([fast, slow], traceId);
    const root = result[0];
    // slow should come first
    expect(root.children[0].event_id).toBe("slow0000aaaabbbb");
  });

  it("includes children of transactions (up to 2)", () => {
    const child1 = makeRawSpan({
      event_id: "ch100000aaaabbbb",
      duration: 200,
      children: [],
    });
    const child2 = makeRawSpan({
      event_id: "ch200000aaaabbbb",
      duration: 150,
      children: [],
    });
    const child3 = makeRawSpan({
      event_id: "ch300000aaaabbbb",
      duration: 100,
      children: [],
    });
    const txn = makeRawSpan({
      event_id: "txn00000aaaabbbb",
      is_transaction: true,
      duration: 500,
      children: [child1, child2, child3],
    });

    const result = selectInterestingSpans([txn], traceId);
    const txnSpan = result[0].children[0];
    // Transactions get up to 2 children
    expect(txnSpan.children.length).toBeLessThanOrEqual(2);
    // Should pick the longest-duration children
    expect(txnSpan.children[0].event_id).toBe("ch100000aaaabbbb");
  });

  it("includes non-transaction children (up to 1)", () => {
    const child1 = makeRawSpan({
      event_id: "ch100000aaaabbbb",
      duration: 200,
      children: [],
    });
    const child2 = makeRawSpan({
      event_id: "ch200000aaaabbbb",
      duration: 150,
      children: [],
    });
    const parent = makeRawSpan({
      event_id: "parent00aaaabbbb",
      is_transaction: false,
      duration: 500,
      children: [child1, child2],
    });

    const result = selectInterestingSpans([parent], traceId);
    const parentSpan = result[0].children[0];
    // Non-transactions get up to 1 child
    expect(parentSpan.children).toHaveLength(1);
    expect(parentSpan.children[0].event_id).toBe("ch100000aaaabbbb");
  });

  it("excludes children below MIN_MEANINGFUL_CHILD_DURATION", () => {
    const tinyChild = makeRawSpan({
      event_id: "tiny0000aaaabbbb",
      duration: 2, // below MIN_MEANINGFUL_CHILD_DURATION (5ms)
      children: [],
    });
    const parent = makeRawSpan({
      event_id: "parent00aaaabbbb",
      is_transaction: true,
      duration: 500,
      children: [tinyChild],
    });

    const result = selectInterestingSpans([parent], traceId);
    const parentSpan = result[0].children[0];
    expect(parentSpan.children).toHaveLength(0);
  });

  it("defaults missing op to 'unknown'", () => {
    const span = makeRawSpan({
      event_id: "noop0000aaaabbbb",
      op: undefined,
      duration: 100,
    });

    const result = selectInterestingSpans([span], traceId);
    expect(result[0].children[0].op).toBe("unknown");
  });

  it("uses transaction field as fallback description", () => {
    const span = makeRawSpan({
      event_id: "txnf0000aaaabbbb",
      description: undefined,
      transaction: "POST /api/submit",
      duration: 100,
    });

    const result = selectInterestingSpans([span], traceId);
    expect(result[0].children[0].description).toBe("POST /api/submit");
  });
});

// ---------------------------------------------------------------------------
// buildFullSpanTree
// ---------------------------------------------------------------------------

describe("buildFullSpanTree", () => {
  const traceId = "aaaaaaaabbbbbbbbccccccccdddddddd";

  it("wraps results in a fake trace root", () => {
    const result = buildFullSpanTree([], traceId);
    expect(result).toHaveLength(1);
    expect(result[0].op).toBe("trace");
    expect(result[0].event_id).toBe(traceId);
    expect(result[0].description).toBe("Trace aaaaaaaa");
    expect(result[0].children).toEqual([]);
  });

  it("converts a flat list of root spans", () => {
    const span1 = makeRawSpan({ event_id: "span1111aaaabbbb", duration: 100 });
    const span2 = makeRawSpan({ event_id: "span2222aaaabbbb", duration: 200 });

    const result = buildFullSpanTree([span1, span2], traceId);
    const root = result[0];
    expect(root.children).toHaveLength(2);
    expect(root.children[0].event_id).toBe("span1111aaaabbbb");
    expect(root.children[1].event_id).toBe("span2222aaaabbbb");
  });

  it("preserves the full hierarchy without filtering", () => {
    const grandchild = makeRawSpan({
      event_id: "gc000000aaaabbbb",
      duration: 1, // would be filtered by selectInterestingSpans
      children: [],
    });
    const child = makeRawSpan({
      event_id: "child000aaaabbbb",
      duration: 3, // below MINIMUM_DURATION_THRESHOLD_MS
      children: [grandchild],
    });
    const root = makeRawSpan({
      event_id: "root0000aaaabbbb",
      duration: 5,
      children: [child],
    });

    const result = buildFullSpanTree([root], traceId);
    const rootSpan = result[0].children[0];
    expect(rootSpan.children).toHaveLength(1);
    expect(rootSpan.children[0].event_id).toBe("child000aaaabbbb");
    expect(rootSpan.children[0].children).toHaveLength(1);
    expect(rootSpan.children[0].children[0].event_id).toBe("gc000000aaaabbbb");
  });

  it("assigns correct levels to nested spans", () => {
    const grandchild = makeRawSpan({
      event_id: "gc",
      children: [],
    });
    const child = makeRawSpan({
      event_id: "ch",
      children: [grandchild],
    });
    const root = makeRawSpan({
      event_id: "rt",
      children: [child],
    });

    const result = buildFullSpanTree([root], traceId);
    expect(result[0].level).toBe(-1); // fake root
    expect(result[0].children[0].level).toBe(0);
    expect(result[0].children[0].children[0].level).toBe(1);
    expect(result[0].children[0].children[0].children[0].level).toBe(2);
  });

  it("filters out non-span items (issues)", () => {
    const span = makeRawSpan({ event_id: "span0000aaaabbbb" });
    const issue = {
      id: 999,
      issue_id: 999,
      title: "TypeError",
      type: "error",
      timestamp: 123,
    };

    const result = buildFullSpanTree([span, issue as any], traceId);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].event_id).toBe("span0000aaaabbbb");
  });

  it("defaults missing fields gracefully", () => {
    const span = makeRawSpan({
      event_id: "bare0000aaaabbbb",
      op: undefined,
      description: undefined,
      duration: undefined,
      is_transaction: undefined,
      name: undefined,
    });

    const result = buildFullSpanTree([span], traceId);
    const converted = result[0].children[0];
    expect(converted.op).toBe("unknown");
    expect(converted.name).toBeNull();
    expect(converted.description).toBe("unnamed");
    expect(converted.duration).toBe(0);
    expect(converted.is_transaction).toBe(false);
  });

  it("works with the trace-mixed fixture shape", () => {
    // Simulates the mixed span + issue array from the real trace API
    const mixedData = [
      makeRawSpan({
        event_id: "aa8e7f3384ef4ff5",
        op: "function",
        description: "tools/call search_events",
        duration: 5203,
        is_transaction: false,
        children: [
          makeRawSpan({
            event_id: "ad0f7c48fb294de3",
            op: "http.client",
            description: "POST https://api.openai.com/v1/chat/completions",
            duration: 1708,
          }),
        ],
      }),
      // Issue item (should be filtered out)
      {
        id: 6507376925,
        issue_id: 6507376925,
        title: "Error: Standalone issue",
        type: "error",
        timestamp: 123,
      },
      makeRawSpan({
        event_id: "b4abfe5ed7984c2b",
        op: "http.client",
        description:
          "GET https://us.sentry.io/api/0/organizations/example-org/events/",
        duration: 1482,
        children: [
          makeRawSpan({
            event_id: "99a97a1d42c3489a",
            op: "http.server",
            description:
              "/api/0/organizations/{organization_id_or_slug}/events/",
            duration: 1408,
          }),
        ],
      }),
    ];

    const result = buildFullSpanTree(
      mixedData as any[],
      "b4d1aae7216b47ff8117cf4e09ce9d0b",
    );

    const root = result[0];
    expect(root.op).toBe("trace");
    // Only 2 real spans at root level (issue is filtered)
    expect(root.children).toHaveLength(2);
    expect(root.children[0].description).toBe("tools/call search_events");
    expect(root.children[0].children).toHaveLength(1);
    expect(root.children[1].description).toContain("GET https://us.sentry.io");
    expect(root.children[1].children).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: buildFullSpanTree + renderSpanTree
// ---------------------------------------------------------------------------

describe("buildFullSpanTree + renderSpanTree integration", () => {
  it("produces a renderable tree from raw trace data", () => {
    const raw = [
      makeRawSpan({
        event_id: "root0000aaaabbbb",
        op: "http.server",
        description: "GET /api/users",
        duration: 250,
        children: [
          makeRawSpan({
            event_id: "db000000aaaabbbb",
            op: "db",
            description: "SELECT * FROM users",
            duration: 15,
          }),
          makeRawSpan({
            event_id: "cache000aaaabbbb",
            op: "cache",
            description: "redis.get user:123",
            duration: 3,
          }),
        ],
      }),
    ];

    const tree = buildFullSpanTree(raw, "aaaaaaaabbbbbbbbccccccccdddddddd");
    const lines = renderSpanTree(tree);

    expect(lines).toMatchInlineSnapshot(`
      [
        "trace [aaaaaaaa]",
        "   └─ GET /api/users [root0000 · http.server · 250ms]",
        "      ├─ SELECT * FROM users [db000000 · db · 15ms]",
        "      └─ redis.get user:123 [cache000 · cache · 3ms]",
      ]
    `);
  });
});
