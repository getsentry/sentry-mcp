/**
 * Reconstruction is the part of a DOM read that fails quietly: a tree built
 * from a mishandled mutation stream is structurally valid and wrong, and
 * nothing downstream can tell. These tests assert the resulting structure
 * rather than that the code ran.
 */
import { describe, expect, it } from "vitest";
import {
  DomReconstructor,
  NODE_TYPE_DOCUMENT,
  NODE_TYPE_ELEMENT,
  NODE_TYPE_TEXT,
  countDropped,
  type DomNode,
} from "./replay-dom.js";
import type { ReplayRecordingEvent } from "../api-client";

const START_MS = 1_744_027_200_000;

/** A serialized element node, as rrweb emits it inside a FullSnapshot. */
function element(
  id: number,
  tagName: string,
  attributes: Record<string, unknown> = {},
  childNodes: unknown[] = [],
) {
  return { id, type: NODE_TYPE_ELEMENT, tagName, attributes, childNodes };
}

function text(id: number, textContent: string) {
  return { id, type: NODE_TYPE_TEXT, textContent };
}

/**
 * A FullSnapshot wrapping the given body children.
 *
 * Mirrors the real shape: an id-less document wrapper containing `html`,
 * containing `body`. The wrapper carries no id, which is why reconstruction has
 * to descend through it rather than expect a root id.
 */
function snapshot(offsetMs: number, bodyChildren: unknown[]) {
  return {
    type: 2,
    timestamp: START_MS + offsetMs,
    data: {
      node: {
        type: NODE_TYPE_DOCUMENT,
        childNodes: [
          element(1, "html", {}, [element(2, "body", {}, bodyChildren)]),
        ],
      },
    },
  } as unknown as ReplayRecordingEvent;
}

function mutation(
  offsetMs: number,
  payload: {
    adds?: unknown[];
    removes?: unknown[];
    attributes?: unknown[];
    texts?: unknown[];
  },
) {
  return {
    type: 3,
    timestamp: START_MS + offsetMs,
    data: {
      source: 0,
      adds: payload.adds ?? [],
      removes: payload.removes ?? [],
      attributes: payload.attributes ?? [],
      texts: payload.texts ?? [],
    },
  } as unknown as ReplayRecordingEvent;
}

function inputEvent(
  offsetMs: number,
  id: number,
  fields: { text?: string; isChecked?: boolean },
) {
  return {
    type: 3,
    timestamp: START_MS + offsetMs,
    data: { source: 5, id, ...fields },
  } as unknown as ReplayRecordingEvent;
}

/** Feed events and finalize, as a streaming caller would. */
function reconstruct(events: ReplayRecordingEvent[], atMs = START_MS + 10_000) {
  const reconstructor = new DomReconstructor({ atMs });
  for (const event of events) {
    if (reconstructor.apply(event) === "past-target") {
      break;
    }
  }
  return reconstructor.result(START_MS);
}

function childTags(node: DomNode | undefined, nodes: Map<number, DomNode>) {
  return (node?.childIds ?? []).map((id) => nodes.get(id)?.tagName ?? "?");
}

describe("FullSnapshot ingest", () => {
  it("descends through the id-less document wrapper", () => {
    const result = reconstruct([snapshot(400, [element(3, "div")])]);

    // The wrapper has no id, so `html` — the first identified node — is root.
    expect(result.rootId).toBe(1);
    expect(result.nodes.get(1)?.tagName).toBe("html");
    expect(result.missingSnapshot).toBe(false);
    expect(result.snapshotOffsetMs).toBe(400);
  });

  it("records parent and child links in both directions", () => {
    const result = reconstruct([snapshot(0, [element(3, "button")])]);

    expect(result.nodes.get(2)?.childIds).toEqual([3]);
    expect(result.nodes.get(3)?.parentId).toBe(2);
  });

  it("keeps text as child nodes rather than element properties", () => {
    // Element nodes carry no textContent in rrweb; a label is a child.
    const result = reconstruct([
      snapshot(0, [element(3, "button", {}, [text(4, "Complete order")])]),
    ]);

    expect(result.nodes.get(3)?.textContent).toBeUndefined();
    expect(result.nodes.get(4)?.textContent).toBe("Complete order");
  });

  it("reports a missing snapshot rather than an empty tree", () => {
    // Reading a window whose snapshot was never fetched must be
    // distinguishable from reading a page that had no content.
    const result = reconstruct([
      mutation(100, { texts: [{ id: 3, value: "x" }] }),
    ]);

    expect(result.missingSnapshot).toBe(true);
    expect(result.rootId).toBeNull();
  });

  it("supersedes an earlier snapshot entirely", () => {
    // A later FullSnapshot is a complete state. Merging into the previous one
    // would resurrect nodes the page had already discarded.
    const result = reconstruct([
      snapshot(0, [element(3, "div", { id: "old" })]),
      mutation(100, {
        attributes: [{ id: 3, attributes: { class: "stale" } }],
      }),
      snapshot(200, [element(9, "section", { id: "new" })]),
    ]);

    expect(result.nodes.has(3)).toBe(false);
    expect(result.nodes.get(9)?.attributes.id).toBe("new");
    expect(result.snapshotOffsetMs).toBe(200);
    // Mutations applied before the newer snapshot no longer count toward it.
    expect(result.mutationsApplied).toBe(0);
  });

  it("drops a duplicate id instead of overwriting a subtree", () => {
    const result = reconstruct([
      snapshot(0, [
        element(3, "div", {}, [element(4, "span")]),
        element(3, "aside"),
      ]),
    ]);

    expect(result.nodes.get(3)?.tagName).toBe("div");
    expect(result.dropped["duplicate-id"]).toBe(1);
  });
});

describe("mutations", () => {
  it("inserts an added node before its nextId sibling", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "header"), element(4, "footer")]),
      mutation(100, {
        adds: [{ parentId: 2, nextId: 4, node: element(5, "main") }],
      }),
    ]);

    expect(childTags(result.nodes.get(2), result.nodes)).toEqual([
      "header",
      "main",
      "footer",
    ]);
  });

  it("appends when nextId is null", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "header")]),
      mutation(100, {
        adds: [{ parentId: 2, nextId: null, node: element(5, "main") }],
      }),
    ]);

    expect(childTags(result.nodes.get(2), result.nodes)).toEqual([
      "header",
      "main",
    ]);
  });

  it("drops an add whose parent is unknown rather than reparenting it", () => {
    // Reparenting to the root would fabricate structure that never existed,
    // and the caller would have no way to know.
    const result = reconstruct([
      snapshot(0, [element(3, "div")]),
      mutation(100, {
        adds: [{ parentId: 999, nextId: null, node: element(5, "span") }],
      }),
    ]);

    expect(result.nodes.has(5)).toBe(false);
    expect(result.dropped["unknown-parent"]).toBe(1);
    expect(countDropped(result.dropped)).toBe(1);
  });

  it("removes a node and its descendants", () => {
    // Leaving descendants behind would let a later add reattach them under a
    // parent that no longer exists.
    const result = reconstruct([
      snapshot(0, [
        element(3, "div", {}, [element(4, "span", {}, [text(5, "hi")])]),
      ]),
      mutation(100, { removes: [{ parentId: 2, id: 3 }] }),
    ]);

    expect(result.nodes.has(3)).toBe(false);
    expect(result.nodes.has(4)).toBe(false);
    expect(result.nodes.has(5)).toBe(false);
    expect(result.nodes.get(2)?.childIds).toEqual([]);
  });

  it("relocates a node without duplicating its subtree", () => {
    // rrweb emits a move as remove-plus-add. Handling the add alone would
    // leave the node in two places.
    const result = reconstruct([
      snapshot(0, [
        element(3, "div", {}, [element(4, "span")]),
        element(6, "aside"),
      ]),
      mutation(100, {
        adds: [{ parentId: 6, nextId: null, node: element(4, "span") }],
      }),
    ]);

    expect(result.nodes.get(3)?.childIds).toEqual([]);
    expect(result.nodes.get(6)?.childIds).toEqual([4]);
    expect(result.nodes.get(4)?.parentId).toBe(6);
  });

  it("applies attribute changes and removals", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "button", { disabled: true, class: "primary" })]),
      mutation(100, {
        attributes: [
          { id: 3, attributes: { disabled: null, class: "loading" } },
        ],
      }),
    ]);

    expect(result.nodes.get(3)?.attributes.disabled).toBeUndefined();
    expect(result.nodes.get(3)?.attributes.class).toBe("loading");
  });

  it("records a style object change without reassembling the declaration", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "div")]),
      mutation(100, {
        attributes: [{ id: 3, attributes: { style: { display: "none" } } }],
      }),
    ]);

    expect(result.nodes.get(3)?.attributes.style).toBe("[style changed]");
  });

  it("applies text changes", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "span", {}, [text(4, "Loading")])]),
      mutation(100, { texts: [{ id: 4, value: "Failed" }] }),
    ]);

    expect(result.nodes.get(4)?.textContent).toBe("Failed");
  });

  it("counts a mutation against an unknown node", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "div")]),
      mutation(100, { texts: [{ id: 999, value: "x" }] }),
    ]);

    expect(result.dropped["unknown-node"]).toBe(1);
  });

  it("ignores sources that change nothing structural", () => {
    // Mouse movement and scroll are the bulk of a real recording; treating
    // them as mutations would inflate the fidelity report into noise.
    const mouseMove = {
      type: 3,
      timestamp: START_MS + 100,
      data: { source: 1, positions: [] },
    } as unknown as ReplayRecordingEvent;

    const result = reconstruct([snapshot(0, [element(3, "div")]), mouseMove]);

    expect(result.mutationsApplied).toBe(0);
    expect(countDropped(result.dropped)).toBe(0);
  });
});

describe("input values", () => {
  it("reads the starting value from the attribute", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "input", { value: "initial" })]),
    ]);

    expect(result.nodes.get(3)?.inputValue).toBe("initial");
  });

  it("updates from a source 5 input event, not an attribute mutation", () => {
    // The failure this guards: applying only source 0 leaves every field at
    // its initial value, producing a tree that looks current and is stale.
    const result = reconstruct([
      snapshot(0, [element(3, "input", { value: "initial" })]),
      inputEvent(100, 3, { text: "typed by the user" }),
    ]);

    expect(result.nodes.get(3)?.inputValue).toBe("typed by the user");
    // The attribute is untouched — the two are deliberately separate, since
    // the attribute records what the page shipped with.
    expect(result.nodes.get(3)?.attributes.value).toBe("initial");
  });

  it("tracks checkbox state", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "input", { type: "checkbox" })]),
      inputEvent(100, 3, { isChecked: true }),
    ]);

    expect(result.nodes.get(3)?.inputChecked).toBe(true);
  });

  it("counts an input event for an unknown node", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "div")]),
      inputEvent(100, 999, { text: "x" }),
    ]);

    expect(result.dropped["unknown-node"]).toBe(1);
  });
});

describe("the target time", () => {
  it("reports past-target so a streaming caller can stop paging", () => {
    const reconstructor = new DomReconstructor({ atMs: START_MS + 500 });

    expect(reconstructor.apply(snapshot(0, [element(3, "div")]))).toBe(
      "applied",
    );
    expect(reconstructor.apply(mutation(400, { texts: [] }))).toBe("applied");
    expect(reconstructor.apply(mutation(600, { texts: [] }))).toBe(
      "past-target",
    );
  });

  it("excludes mutations after the target", () => {
    // The point of a point-in-time read: the page as it stood then, not as it
    // ended up.
    const result = reconstruct(
      [
        snapshot(0, [element(3, "span", {}, [text(4, "before")])]),
        mutation(1_000, { texts: [{ id: 4, value: "after" }] }),
      ],
      START_MS + 500,
    );

    expect(result.nodes.get(4)?.textContent).toBe("before");
    expect(result.mutationsApplied).toBe(0);
  });

  it("prefers the newest snapshot at or before the target", () => {
    // Whether a recording carries one snapshot or many is not fixed, so the
    // same rule has to serve both.
    const result = reconstruct(
      [
        snapshot(0, [element(3, "div", { id: "first" })]),
        snapshot(200, [element(3, "div", { id: "second" })]),
        snapshot(9_000, [element(3, "div", { id: "too-late" })]),
      ],
      START_MS + 1_000,
    );

    expect(result.nodes.get(3)?.attributes.id).toBe("second");
    expect(result.snapshotOffsetMs).toBe(200);
  });
});

describe("malformed payloads", () => {
  it("counts a snapshot with no node", () => {
    const broken = {
      type: 2,
      timestamp: START_MS,
      data: {},
    } as unknown as ReplayRecordingEvent;

    const result = reconstruct([broken]);

    expect(result.missingSnapshot).toBe(true);
    expect(result.dropped.malformed).toBe(1);
  });

  it("counts an add with no parentId", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "div")]),
      mutation(100, { adds: [{ nextId: null, node: element(5, "span") }] }),
    ]);

    expect(result.dropped.malformed).toBe(1);
  });

  it("survives an attribute payload that is not an object", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "div")]),
      mutation(100, { attributes: [{ id: 3, attributes: "nonsense" }] }),
    ]);

    expect(result.dropped.malformed).toBe(1);
    expect(result.nodes.get(3)?.tagName).toBe("div");
  });
});
