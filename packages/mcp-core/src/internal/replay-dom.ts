/**
 * DOM reconstruction from rrweb recording events.
 *
 * A replay recording is a stream of rrweb events. `replay-events.ts` reads the
 * custom events (`type: 5`) that describe *what the user did*; this module
 * reads the two that describe *what the page was*:
 *
 * - `type: 2` (`FullSnapshot`) — a complete serialized DOM.
 * - `type: 3` (`IncrementalSnapshot`) — mutations against it.
 *
 * State at a moment is the last snapshot at or before that moment, with every
 * intervening mutation applied in order. Upstream's `which()` ignores both
 * types, so nothing here is a port — the semantics come from rrweb's own type
 * definitions (`rrweb-io/rrweb`, `packages/types/src/index.ts`), against which
 * the constants below were verified.
 *
 * Three details that are easy to get wrong, in descending order of how
 * quietly they fail:
 *
 * - **Input values arrive as `source: 5`, not as attribute mutations.** A
 *   reconstruction that applies only `source: 0` shows every form field at its
 *   initial value. That is worse than showing nothing: it looks authoritative
 *   and is stale.
 * - **Element nodes have no `textContent`.** A button's label is a child text
 *   node, not a property of the button.
 * - **A recording may contain one snapshot or many.** rrweb re-snapshots on
 *   `checkoutEveryNms`, and Sentry's SDK treats a recording's first event as a
 *   checkout, so the count is not fixed. Keeping only the newest snapshot at or
 *   before the target handles both without branching.
 *
 * Fidelity is reported rather than assumed. A reconstruction can be complete,
 * partial, or wrong, and those are indistinguishable from the resulting tree,
 * so every dropped operation is counted and surfaced.
 */

import type { ReplayRecordingEvent } from "../api-client";
import { isPlainObject } from "./type-guards";

/** rrweb `EventType`. Only the two structural members are needed here. */
const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_INCREMENTAL_SNAPSHOT = 3;

/** rrweb `IncrementalSource`. */
const SOURCE_MUTATION = 0;
const SOURCE_INPUT = 5;

/**
 * rrweb `NodeType`.
 *
 * Document and Element carry `childNodes`; Text, CDATA, and Comment carry
 * `textContent`. DocumentType carries neither.
 */
export const NODE_TYPE_DOCUMENT = 0;
export const NODE_TYPE_DOCUMENT_TYPE = 1;
export const NODE_TYPE_ELEMENT = 2;
export const NODE_TYPE_TEXT = 3;
export const NODE_TYPE_CDATA = 4;
export const NODE_TYPE_COMMENT = 5;

/**
 * A node in the reconstructed tree.
 *
 * Children are held as ids rather than references so that a `remove` is a
 * single splice and an `add` cannot create a cycle by aliasing. The node map
 * owns every node; this is a flat store with parent and child links, not a
 * nested object graph.
 */
export interface DomNode {
  id: number;
  nodeType: number;
  /** Element tag name, lowercased by rrweb. Absent on non-elements. */
  tagName?: string;
  /** Element attributes. Values may be strings, numbers, or `true`. */
  attributes: Record<string, string | number | boolean>;
  /** Text content, for text, CDATA, and comment nodes. */
  textContent?: string;
  childIds: number[];
  parentId: number | null;
  /**
   * Current value, for form controls.
   *
   * Tracked separately from `attributes.value` because rrweb reports value
   * changes through input events, not attribute mutations. The initial value
   * arrives as an attribute; every change after that arrives here.
   */
  inputValue?: string;
  inputChecked?: boolean;
}

/** Why a reconstruction dropped an operation. */
export type DomDropReason =
  | "unknown-parent"
  | "unknown-node"
  | "malformed"
  | "duplicate-id";

/**
 * What a reconstruction did, so a caller can say how much to trust it.
 *
 * A tree assembled from a snapshot that dropped a third of its mutations is
 * not obviously different from a clean one, and the difference decides whether
 * the answer is usable.
 */
export interface DomReconstruction {
  /** The node map, keyed by rrweb node id. */
  nodes: Map<number, DomNode>;
  /** Root node id — the document, or the first node with no parent. */
  rootId: number | null;
  /** Offset of the snapshot this was built from, in ms from the replay start. */
  snapshotOffsetMs: number | null;
  /** How many mutation events were applied. */
  mutationsApplied: number;
  /** Dropped operations, by reason. */
  dropped: Record<DomDropReason, number>;
  /** True when no `FullSnapshot` was found at or before the target. */
  missingSnapshot: boolean;
}

export interface ReconstructOptions {
  /**
   * Target time, in epoch milliseconds.
   *
   * Events after this are ignored, so the result is the page as it stood at
   * that moment rather than at the end of the recording.
   */
  atMs: number;
}

function emptyDropCounts(): Record<DomDropReason, number> {
  return {
    "unknown-parent": 0,
    "unknown-node": 0,
    malformed: 0,
    "duplicate-id": 0,
  };
}

/**
 * Total dropped operations across all reasons.
 */
export function countDropped(dropped: Record<DomDropReason, number>): number {
  return Object.values(dropped).reduce((sum, count) => sum + count, 0);
}

/**
 * Incrementally folds rrweb events into a DOM state.
 *
 * Segment-at-a-time rather than all-at-once, so a caller can stream a
 * recording and never hold it. Feeding events out of order is not supported —
 * rrweb mutations are only meaningful in sequence.
 */
export class DomReconstructor {
  private nodes = new Map<number, DomNode>();
  private rootId: number | null = null;
  private snapshotTimestampMs: number | null = null;
  private mutationsApplied = 0;
  private dropped = emptyDropCounts();
  private readonly atMs: number;

  constructor(options: ReconstructOptions) {
    this.atMs = options.atMs;
  }

  /**
   * Applies one event.
   *
   * Returns `"past-target"` once an event's timestamp is beyond the target,
   * which lets a streaming caller stop paging rather than read the rest of the
   * session for events it will discard.
   */
  apply(event: ReplayRecordingEvent): "applied" | "ignored" | "past-target" {
    const timestamp =
      typeof event.timestamp === "number" ? event.timestamp : null;
    if (timestamp !== null && timestamp > this.atMs) {
      return "past-target";
    }

    if (event.type === RRWEB_FULL_SNAPSHOT) {
      // A later snapshot supersedes everything applied so far: it is a
      // complete state, so replaying earlier mutations onto it would be wrong.
      this.ingestSnapshot(event, timestamp);
      return "applied";
    }

    if (event.type === RRWEB_INCREMENTAL_SNAPSHOT) {
      return this.applyIncremental(event);
    }

    return "ignored";
  }

  /**
   * Finalizes and returns the reconstruction.
   */
  result(replayStartedAtMs: number | null): DomReconstruction {
    const snapshotOffsetMs =
      this.snapshotTimestampMs !== null && replayStartedAtMs !== null
        ? this.snapshotTimestampMs - replayStartedAtMs
        : null;

    return {
      nodes: this.nodes,
      rootId: this.rootId,
      snapshotOffsetMs,
      mutationsApplied: this.mutationsApplied,
      dropped: { ...this.dropped },
      missingSnapshot: this.snapshotTimestampMs === null,
    };
  }

  private ingestSnapshot(
    event: ReplayRecordingEvent,
    timestamp: number | null,
  ): void {
    const data = event.data;
    if (!isPlainObject(data)) {
      this.dropped.malformed += 1;
      return;
    }

    const node = (data as { node?: unknown }).node;
    if (!isPlainObject(node)) {
      this.dropped.malformed += 1;
      return;
    }

    // Replace wholesale. Mutations applied before this snapshot described a
    // state this snapshot already supersedes.
    this.nodes = new Map();
    this.rootId = null;
    this.mutationsApplied = 0;
    this.snapshotTimestampMs = timestamp;

    const rootId = this.serializeInto(node, null);
    this.rootId = rootId;
  }

  /**
   * Walks a serialized rrweb node into the flat node map.
   *
   * Returns the node's id, or null when it carried none — an unidentified node
   * cannot be referenced by a later mutation, so it is dropped rather than
   * given a synthetic id that nothing will match.
   */
  private serializeInto(raw: unknown, parentId: number | null): number | null {
    if (!isPlainObject(raw)) {
      this.dropped.malformed += 1;
      return null;
    }

    const id = typeof raw.id === "number" ? raw.id : null;
    const nodeType = typeof raw.type === "number" ? raw.type : null;

    // The document wrapper in a FullSnapshot carries childNodes but no id.
    // Descend through it so the html element becomes the root.
    if (id === null) {
      const childNodes = Array.isArray(raw.childNodes) ? raw.childNodes : [];
      let firstChildId: number | null = null;
      for (const child of childNodes) {
        const childId = this.serializeInto(child, parentId);
        if (firstChildId === null) {
          firstChildId = childId;
        }
      }
      return firstChildId;
    }

    if (this.nodes.has(id)) {
      // rrweb ids are unique within a recording; a repeat means the payload is
      // inconsistent, and overwriting would silently discard a subtree.
      this.dropped["duplicate-id"] += 1;
      return null;
    }

    const node: DomNode = {
      id,
      nodeType: nodeType ?? NODE_TYPE_ELEMENT,
      attributes: readAttributes(raw.attributes),
      childIds: [],
      parentId,
    };

    if (typeof raw.tagName === "string") {
      node.tagName = raw.tagName;
    }
    if (typeof raw.textContent === "string") {
      node.textContent = raw.textContent;
    }
    // A form control's starting value arrives as an attribute; input events
    // take over from there.
    const initialValue = node.attributes.value;
    if (typeof initialValue === "string") {
      node.inputValue = initialValue;
    }

    this.nodes.set(id, node);

    const childNodes = Array.isArray(raw.childNodes) ? raw.childNodes : [];
    for (const child of childNodes) {
      const childId = this.serializeInto(child, id);
      if (childId !== null) {
        node.childIds.push(childId);
      }
    }

    return id;
  }

  private applyIncremental(event: ReplayRecordingEvent): "applied" | "ignored" {
    const data = event.data;
    if (!isPlainObject(data)) {
      return "ignored";
    }

    const source = (data as { source?: unknown }).source;

    if (source === SOURCE_MUTATION) {
      this.applyMutation(data);
      this.mutationsApplied += 1;
      return "applied";
    }

    if (source === SOURCE_INPUT) {
      this.applyInput(data);
      this.mutationsApplied += 1;
      return "applied";
    }

    // Every other source — mouse movement, scroll, viewport, canvas — changes
    // nothing about the structure this module reports.
    return "ignored";
  }

  /**
   * Applies a `source: 0` mutation.
   *
   * Order matters: removes before adds, so a node moved within the tree does
   * not collide with itself, and attributes and texts last so they apply to
   * nodes this batch may have just added.
   */
  private applyMutation(data: Record<string, unknown>): void {
    for (const removal of asArray(data.removes)) {
      this.applyRemoval(removal);
    }
    for (const addition of asArray(data.adds)) {
      this.applyAddition(addition);
    }
    for (const change of asArray(data.attributes)) {
      this.applyAttributeChange(change);
    }
    for (const change of asArray(data.texts)) {
      this.applyTextChange(change);
    }
  }

  private applyRemoval(raw: unknown): void {
    if (!isPlainObject(raw) || typeof raw.id !== "number") {
      this.dropped.malformed += 1;
      return;
    }

    const node = this.nodes.get(raw.id);
    if (!node) {
      this.dropped["unknown-node"] += 1;
      return;
    }

    this.detach(node);
    // Drop the subtree with it. Leaving descendants in the map would let a
    // later add reattach them under a parent that no longer exists.
    this.deleteSubtree(node.id);
  }

  private applyAddition(raw: unknown): void {
    if (!isPlainObject(raw)) {
      this.dropped.malformed += 1;
      return;
    }

    const parentId = typeof raw.parentId === "number" ? raw.parentId : null;
    if (parentId === null) {
      this.dropped.malformed += 1;
      return;
    }

    const parent = this.nodes.get(parentId);
    if (!parent) {
      // The parent was pruned, or arrived in a snapshot this read never saw.
      // Reparenting to the root would fabricate structure that never existed,
      // so drop and count instead.
      this.dropped["unknown-parent"] += 1;
      return;
    }

    const existing =
      isPlainObject(raw.node) && typeof raw.node.id === "number"
        ? this.nodes.get(raw.node.id)
        : undefined;
    if (existing) {
      // A move, not an insert: rrweb emits a remove plus an add for relocated
      // nodes, but a stale duplicate would otherwise double the subtree.
      this.detach(existing);
      this.deleteSubtree(existing.id);
    }

    const childId = this.serializeInto(raw.node, parentId);
    if (childId === null) {
      return;
    }

    // `nextId` names the sibling this node precedes. `previousId` exists only
    // for backward compatibility and is deliberately ignored.
    const nextId = typeof raw.nextId === "number" ? raw.nextId : null;
    const index = nextId !== null ? parent.childIds.indexOf(nextId) : -1;
    if (index >= 0) {
      parent.childIds.splice(index, 0, childId);
    } else {
      parent.childIds.push(childId);
    }
  }

  private applyAttributeChange(raw: unknown): void {
    if (!isPlainObject(raw) || typeof raw.id !== "number") {
      this.dropped.malformed += 1;
      return;
    }

    const node = this.nodes.get(raw.id);
    if (!node) {
      this.dropped["unknown-node"] += 1;
      return;
    }

    const attributes = isPlainObject(raw.attributes) ? raw.attributes : null;
    if (!attributes) {
      this.dropped.malformed += 1;
      return;
    }

    for (const [key, value] of Object.entries(attributes)) {
      if (value === null) {
        // rrweb signals attribute removal with null.
        delete node.attributes[key];
        continue;
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        value === true
      ) {
        node.attributes[key] = value;
        continue;
      }
      // A styleOMValue object. Recording that the style changed is honest;
      // reassembling the declaration is not this module's job.
      if (isPlainObject(value)) {
        node.attributes[key] = "[style changed]";
      }
    }
  }

  private applyTextChange(raw: unknown): void {
    if (!isPlainObject(raw) || typeof raw.id !== "number") {
      this.dropped.malformed += 1;
      return;
    }

    const node = this.nodes.get(raw.id);
    if (!node) {
      this.dropped["unknown-node"] += 1;
      return;
    }

    node.textContent = typeof raw.value === "string" ? raw.value : "";
  }

  /**
   * Applies a `source: 5` input event.
   *
   * This is the one a `source: 0`-only implementation misses, and missing it
   * produces a tree that looks current and reports stale values.
   */
  private applyInput(data: Record<string, unknown>): void {
    const id = typeof data.id === "number" ? data.id : null;
    if (id === null) {
      this.dropped.malformed += 1;
      return;
    }

    const node = this.nodes.get(id);
    if (!node) {
      this.dropped["unknown-node"] += 1;
      return;
    }

    if (typeof data.text === "string") {
      node.inputValue = data.text;
    }
    if (typeof data.isChecked === "boolean") {
      node.inputChecked = data.isChecked;
    }
  }

  /** Unlinks a node from its parent without deleting it. */
  private detach(node: DomNode): void {
    if (node.parentId === null) {
      return;
    }
    const parent = this.nodes.get(node.parentId);
    if (!parent) {
      return;
    }
    const index = parent.childIds.indexOf(node.id);
    if (index >= 0) {
      parent.childIds.splice(index, 1);
    }
  }

  /** Deletes a node and everything beneath it. */
  private deleteSubtree(id: number): void {
    const node = this.nodes.get(id);
    if (!node) {
      return;
    }
    // Iterative rather than recursive: a deep DOM would otherwise risk the
    // call stack on a path that is already handling untrusted depth.
    const stack = [...node.childIds];
    this.nodes.delete(id);
    while (stack.length > 0) {
      const childId = stack.pop();
      if (childId === undefined) {
        continue;
      }
      const child = this.nodes.get(childId);
      if (!child) {
        continue;
      }
      stack.push(...child.childIds);
      this.nodes.delete(childId);
    }
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Reads an rrweb attribute map.
 *
 * Values may be strings, numbers (scroll offsets, media positions), or `true`
 * (a valueless attribute such as a checked radio). `_cssText` is dropped: it
 * is a whole stylesheet, and no structural question needs it.
 */
function readAttributes(
  raw: unknown,
): Record<string, string | number | boolean> {
  if (!isPlainObject(raw)) {
    return {};
  }

  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "_cssText") {
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      value === true
    ) {
      attributes[key] = value;
    }
  }
  return attributes;
}
