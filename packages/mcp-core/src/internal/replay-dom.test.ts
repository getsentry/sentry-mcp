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
  renderDomTree,
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

/** Ids for the document frame, kept clear of the small ids tests use. */
const DOCUMENT_ID = 1;
const HTML_ID = 9001;
const BODY_ID = 9002;

/**
 * A FullSnapshot wrapping the given body children.
 *
 * The document node carries an id, which is the detail that matters: verified
 * against the `@sentry-internal/rrweb-snapshot` build Sentry ships, where
 * `serializeNodeWithId` assigns an id to every node including the Document
 * (`genId()` starts at 1, so it is normally id 1). A reconstruction's root is
 * therefore a `nodeType: 0` node rather than an element, and a renderer that
 * expects an element root produces nothing at all.
 *
 * `html` and `body` would really be 2 and 3. They are numbered out of the way
 * here so each test can use small ids for the nodes it cares about — rrweb ids
 * are opaque integers, and nothing under test depends on them being sequential.
 */
function snapshot(offsetMs: number, bodyChildren: unknown[]) {
  return {
    type: 2,
    timestamp: START_MS + offsetMs,
    data: {
      node: {
        id: DOCUMENT_ID,
        type: NODE_TYPE_DOCUMENT,
        childNodes: [
          element(HTML_ID, "html", {}, [
            element(BODY_ID, "body", {}, bodyChildren),
          ]),
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
  it("roots at the document node, which is not an element", () => {
    const result = reconstruct([snapshot(400, [element(3, "div")])]);

    // rrweb assigns the Document an id like any other node, so the root of a
    // reconstruction is a `nodeType: 0` node. Rendering has to descend past it.
    expect(result.rootId).toBe(DOCUMENT_ID);
    expect(result.nodes.get(DOCUMENT_ID)?.nodeType).toBe(NODE_TYPE_DOCUMENT);
    expect(result.nodes.get(HTML_ID)?.tagName).toBe("html");
    expect(result.missingSnapshot).toBe(false);
    expect(result.snapshotOffsetMs).toBe(400);
  });

  it("records parent and child links in both directions", () => {
    const result = reconstruct([snapshot(0, [element(3, "button")])]);

    expect(result.nodes.get(BODY_ID)?.childIds).toEqual([3]);
    expect(result.nodes.get(3)?.parentId).toBe(BODY_ID);
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
        adds: [{ parentId: BODY_ID, nextId: 4, node: element(5, "main") }],
      }),
    ]);

    expect(childTags(result.nodes.get(BODY_ID), result.nodes)).toEqual([
      "header",
      "main",
      "footer",
    ]);
  });

  it("appends when nextId is null", () => {
    const result = reconstruct([
      snapshot(0, [element(3, "header")]),
      mutation(100, {
        adds: [{ parentId: BODY_ID, nextId: null, node: element(5, "main") }],
      }),
    ]);

    expect(childTags(result.nodes.get(BODY_ID), result.nodes)).toEqual([
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
      mutation(100, { removes: [{ parentId: BODY_ID, id: 3 }] }),
    ]);

    expect(result.nodes.has(3)).toBe(false);
    expect(result.nodes.has(4)).toBe(false);
    expect(result.nodes.has(5)).toBe(false);
    expect(result.nodes.get(BODY_ID)?.childIds).toEqual([]);
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

describe("rendering", () => {
  /** A checkout form: a container, two inputs, and a submit button. */
  function checkoutSnapshot() {
    return snapshot(0, [
      element(10, "div", { class: "page wrapper" }, [
        element(11, "form", { id: "checkout-form" }, [
          element(12, "div", { class: "address-block" }, [
            element(13, "input", { id: "unit", value: "***" }),
            element(14, "input", { id: "zip", value: "***" }),
          ]),
          element(15, "button", { id: "complete-order", disabled: true }, [
            text(16, "Complete order"),
          ]),
        ]),
      ]),
    ]);
  }

  it("prunes a deep branch locally, leaving later siblings intact", () => {
    // The real failure this reproduces: on a live page `head` is deep enough
    // that aborting the walk at the depth limit hid `body` and everything under
    // it. Depth pruning must drop only the offending branch.
    const deepThenShallow = snapshot(0, [
      element(10, "div", { id: "deep" }, [
        element(11, "div", {}, [
          element(12, "div", {}, [element(13, "button", { id: "buried" })]),
        ]),
      ]),
      element(20, "button", { id: "later-sibling" }),
    ]);

    const rendered = renderDomTree(reconstruct([deepThenShallow]), {
      lens: "full",
      maxDepth: 3,
    });
    const output = rendered.lines.join("\n");

    // `div#deep` sits at the limit; its children are pruned.
    expect(output).toContain("div#deep");
    expect(output).not.toContain("buried");
    // The sibling that comes after the pruned branch must still render.
    expect(output).toContain("button#later-sibling");
    expect(rendered.depthLimitedSubtrees).toBeGreaterThan(0);
    expect(rendered.nodeLimitReached).toBe(false);
  });

  it("renders from the document root by descending to the first element", () => {
    // The regression this guards: rrweb roots a snapshot at the Document node,
    // which is not an element, and a renderer that walks from it directly emits
    // nothing at all. Rendering unrooted must still produce a tree.
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      lens: "full",
    });

    expect(rendered.lines[0]).toBe("html  id=9001");
    expect(rendered.rootNotFound).toBe(false);
    expect(rendered.nodesRendered).toBeGreaterThan(1);
  });

  it("descends past a doctype sibling to reach html", () => {
    // A real snapshot's document has the doctype as its first child, so a
    // depth-first search for the first element would stop on the wrong node.
    const withDoctype = {
      type: 2,
      timestamp: START_MS,
      data: {
        node: {
          id: DOCUMENT_ID,
          type: NODE_TYPE_DOCUMENT,
          childNodes: [
            { id: 8000, type: 1, name: "html", publicId: "", systemId: "" },
            element(HTML_ID, "html", {}, [
              element(BODY_ID, "body", {}, [element(3, "button")]),
            ]),
          ],
        },
      },
    } as unknown as ReplayRecordingEvent;

    const rendered = renderDomTree(reconstruct([withDoctype]), {
      lens: "full",
    });

    expect(rendered.lines[0]).toBe("html  id=9001");
  });

  it("renders a tree with connectors and node ids", () => {
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      rootNodeId: 11,
    });

    expect(rendered.lines.join("\n")).toMatchInlineSnapshot(`
      "form#checkout-form  id=11
      ├─ div.address-block  id=12
      │  ├─ input#unit  [value="***"]  id=13
      │  └─ input#zip  [value="***"]  id=14
      └─ button#complete-order  "Complete order"  [disabled]  id=15"
    `);
  });

  it("takes element text from child text nodes", () => {
    // rrweb element nodes carry no textContent, so a label only appears if the
    // renderer looks at children.
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      rootNodeId: 15,
    });

    expect(rendered.lines[0]).toContain('"Complete order"');
  });

  it("does not let a container inherit its descendants' text", () => {
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      rootNodeId: 11,
    });

    expect(rendered.lines[0]).not.toContain("Complete order");
  });

  it("takes text only from text children, not from nested elements", () => {
    // An element child may carry its own text; treating it as this element's
    // text would attribute a label to the wrong node. The distinguishing case
    // needs an element child that has textContent set, which only happens for
    // a malformed or unusual payload — hence asserting on node type rather
    // than on the presence of the field.
    const oddPayload = snapshot(0, [
      element(20, "div", { id: "container" }, [
        {
          id: 21,
          type: NODE_TYPE_ELEMENT,
          tagName: "span",
          attributes: {},
          childNodes: [],
          textContent: "child element text",
        },
        text(22, "own text"),
      ]),
    ]);

    const rendered = renderDomTree(reconstruct([oddPayload]), {
      rootNodeId: 20,
      lens: "full",
    });

    expect(rendered.lines[0]).toContain('"own text"');
    expect(rendered.lines[0]).not.toContain("child element text");
  });

  it("roots at a node id, excluding everything above it", () => {
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      rootNodeId: 12,
    });

    expect(rendered.lines[0]).toContain("div.address-block");
    expect(rendered.lines.join("\n")).not.toContain("checkout-form");
  });

  it("reports a root id that is not in the reconstruction", () => {
    // Silently falling back to the document root would answer a question the
    // caller did not ask.
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      rootNodeId: 9999,
    });

    expect(rendered.rootNotFound).toBe(true);
    expect(rendered.lines).toEqual([]);
  });

  describe("the interactive lens", () => {
    it("keeps interactive elements and the ancestors that place them", () => {
      const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
        lens: "interactive",
      });
      const output = rendered.lines.join("\n");

      expect(output).toContain("button#complete-order");
      expect(output).toContain("input#unit");
      // div.address-block is inert but is on the path to the inputs.
      expect(output).toContain("div.address-block");
    });

    it("drops inert leaves", () => {
      const withDecoration = snapshot(0, [
        element(10, "div", {}, [
          element(11, "span", { class: "decoration" }),
          element(12, "button", { id: "go" }),
        ]),
      ]);

      const rendered = renderDomTree(reconstruct([withDecoration]), {
        lens: "interactive",
      });

      expect(rendered.lines.join("\n")).toContain("button#go");
      expect(rendered.lines.join("\n")).not.toContain("decoration");
    });

    it("keeps an element made interactive by an attribute alone", () => {
      const withRole = snapshot(0, [
        element(10, "div", { role: "button", id: "fake-button" }),
      ]);

      const rendered = renderDomTree(reconstruct([withRole]), {
        lens: "interactive",
      });

      expect(rendered.lines.join("\n")).toContain("fake-button");
    });

    it("keeps inert elements under the full lens", () => {
      const withDecoration = snapshot(0, [
        element(10, "div", {}, [element(11, "span", { class: "decoration" })]),
      ]);

      const rendered = renderDomTree(reconstruct([withDecoration]), {
        lens: "full",
      });

      expect(rendered.lines.join("\n")).toContain("decoration");
    });
  });

  it("renders the current input value, not the shipped attribute", () => {
    const result = reconstruct([
      snapshot(0, [element(10, "input", { id: "email", value: "initial" })]),
      inputEvent(100, 10, { text: "typed@example.com" }),
    ]);

    const rendered = renderDomTree(result, { rootNodeId: 10 });

    expect(rendered.lines[0]).toContain('[value="typed@example.com"]');
    expect(rendered.lines[0]).not.toContain("initial");
  });

  it("renders masked values as delivered rather than claiming redaction", () => {
    // SDK masking leaves no marker, so labeling this <redacted> would assert
    // something the recording cannot support.
    const rendered = renderDomTree(reconstruct([checkoutSnapshot()]), {
      rootNodeId: 13,
    });

    expect(rendered.lines[0]).toContain('[value="***"]');
    expect(rendered.lines[0]).not.toContain("redacted");
  });

  it("stops at maxNodes and says so", () => {
    const wide = snapshot(0, [
      element(
        10,
        "div",
        {},
        Array.from({ length: 20 }, (_unused, index) =>
          element(100 + index, "button", { id: `b${index}` }),
        ),
      ),
    ]);

    const rendered = renderDomTree(reconstruct([wide]), { maxNodes: 5 });

    expect(rendered.nodesRendered).toBe(5);
    expect(rendered.truncated).toBe(true);
  });

  it("stops at maxDepth and says so", () => {
    // Build a deep chain so depth, not breadth, is what cuts it off.
    let deepest: unknown = element(60, "button", { id: "deep" });
    for (let id = 59; id >= 50; id -= 1) {
      deepest = element(id, "div", {}, [deepest]);
    }

    const rendered = renderDomTree(reconstruct([snapshot(0, [deepest])]), {
      maxDepth: 3,
      lens: "full",
    });

    expect(rendered.truncated).toBe(true);
    expect(rendered.nodesRendered).toBeLessThan(10);
  });

  it("returns nothing for a reconstruction with no snapshot", () => {
    const rendered = renderDomTree(
      reconstruct([mutation(100, { texts: [{ id: 1, value: "x" }] })]),
    );

    expect(rendered.lines).toEqual([]);
    expect(rendered.rootNotFound).toBe(false);
  });
});
