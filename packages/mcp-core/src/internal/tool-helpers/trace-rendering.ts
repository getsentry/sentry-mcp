// Constants for span filtering and tree rendering
export const MAX_DEPTH = 2;
export const MINIMUM_DURATION_THRESHOLD_MS = 10;
export const MIN_MEANINGFUL_CHILD_DURATION = 5;
export const MIN_AVG_DURATION_MS = 5;

/**
 * Filters out non-span items (e.g. issues) from trace data.
 * Spans must have a `children` array and a `duration` field.
 */
function filterActualSpans(spans: unknown[]): any[] {
  return spans.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      "children" in item &&
      Array.isArray((item as any).children) &&
      "duration" in item,
  );
}

export interface SelectedSpan {
  event_id: string;
  op: string;
  name: string | null;
  description: string;
  duration: number;
  is_transaction: boolean;
  children: SelectedSpan[];
  level: number;
}

/**
 * Formats a span display name for the tree view.
 *
 * Uses span.name if available (OTEL-native), otherwise falls back to span.description.
 */
export function formatSpanDisplayName(span: SelectedSpan): string {
  if (span.op === "trace") {
    return "trace";
  }
  return span.name?.trim() || span.description || "unnamed";
}

/**
 * Renders a hierarchical tree structure of spans using Unicode box-drawing characters.
 */
export function renderSpanTree(spans: SelectedSpan[]): string[] {
  const lines: string[] = [];

  function renderSpan(span: SelectedSpan, prefix = "", isLast = true): void {
    const shortId = span.event_id.substring(0, 8);
    const connector = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
    const displayName = formatSpanDisplayName(span);

    if (span.op === "trace") {
      lines.push(`${prefix}${connector}${displayName} [${shortId}]`);
    } else {
      const duration = span.duration
        ? `${Math.round(span.duration)}ms`
        : "unknown";
      const opDisplay = span.op === "default" ? "" : ` · ${span.op}`;
      lines.push(
        `${prefix}${connector}${displayName} [${shortId}${opDisplay} · ${duration}]`,
      );
    }

    for (let i = 0; i < span.children.length; i++) {
      const child = span.children[i];
      const isLastChild = i === span.children.length - 1;
      const childPrefix = prefix + (isLast ? "   " : "│  ");
      renderSpan(child, childPrefix, isLastChild);
    }
  }

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const isLastRoot = i === spans.length - 1;
    renderSpan(span, "", isLastRoot);
  }

  return lines;
}

/**
 * Flattens a hierarchical span tree into a single array.
 * Filters out non-span items (issues) from the trace data.
 */
export function getAllSpansFlattened(spans: unknown[]): any[] {
  const result: any[] = [];
  const actualSpans = filterActualSpans(spans);

  function collectSpans(spanList: any[]) {
    for (const span of spanList) {
      result.push(span);
      if (span.children && span.children.length > 0) {
        collectSpans(span.children);
      }
    }
  }

  collectSpans(actualSpans);
  return result;
}

/**
 * Selects a subset of "interesting" spans from a trace for display in the overview.
 *
 * Creates a fake root span representing the entire trace, with selected interesting
 * spans as children. Selection prioritizes:
 *
 * 1. **Transactions** - Top-level operations
 * 2. **Error spans** - Any spans that contain errors
 * 3. **Long-running spans** - Operations >= 10ms duration
 * 4. **Hierarchical context** - Maintains parent-child relationships
 */
export function selectInterestingSpans(
  spans: any[],
  traceId: string,
  maxSpans = 20,
): SelectedSpan[] {
  const selected: SelectedSpan[] = [];
  let spanCount = 0;
  const actualSpans = filterActualSpans(spans);

  function addSpan(span: any, level: number): boolean {
    if (spanCount >= maxSpans || level > MAX_DEPTH) return false;

    const duration = span.duration || 0;
    const isTransaction = span.is_transaction;
    const hasErrors = span.errors?.length > 0;

    const shouldInclude =
      isTransaction ||
      hasErrors ||
      level === 0 ||
      duration >= MINIMUM_DURATION_THRESHOLD_MS;

    if (!shouldInclude) return false;

    const selectedSpan: SelectedSpan = {
      event_id: span.event_id,
      op: span.op || "unknown",
      name: span.name || null,
      description: span.description || span.transaction || "unnamed",
      duration,
      is_transaction: isTransaction,
      children: [],
      level,
    };

    spanCount++;

    if (level < MAX_DEPTH && span.children?.length > 0) {
      const sortedChildren = span.children
        .filter((child: any) => child.duration > MIN_MEANINGFUL_CHILD_DURATION)
        .sort((a: any, b: any) => (b.duration || 0) - (a.duration || 0));

      const maxChildren = isTransaction ? 2 : 1;
      let addedChildren = 0;

      for (const child of sortedChildren) {
        if (addedChildren >= maxChildren || spanCount >= maxSpans) break;

        if (addSpan(child, level + 1)) {
          const childSpan = selected[selected.length - 1];
          selectedSpan.children.push(childSpan);
          addedChildren++;
        }
      }
    }

    selected.push(selectedSpan);
    return true;
  }

  const sortedRoots = actualSpans
    .sort((a: any, b: any) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 5);

  for (const root of sortedRoots) {
    if (spanCount >= maxSpans) break;
    addSpan(root, 0);
  }

  const rootSpans = selected.filter((span) => span.level === 0);

  const fakeRoot: SelectedSpan = {
    event_id: traceId,
    op: "trace",
    name: null,
    description: `Trace ${traceId.substring(0, 8)}`,
    duration: 0,
    is_transaction: false,
    children: rootSpans,
    level: -1,
  };

  return [fakeRoot];
}

/**
 * Converts raw trace data into a full SelectedSpan tree without any filtering.
 * Used by the `spans` resource type to show the complete span tree.
 */
export function buildFullSpanTree(
  spans: any[],
  traceId: string,
): SelectedSpan[] {
  const actualSpans = filterActualSpans(spans);

  function convertSpan(span: any, level: number): SelectedSpan {
    const children: SelectedSpan[] = [];
    if (span.children?.length > 0) {
      for (const child of span.children) {
        children.push(convertSpan(child, level + 1));
      }
    }

    return {
      event_id: span.event_id,
      op: span.op || "unknown",
      name: span.name || null,
      description: span.description || span.transaction || "unnamed",
      duration: span.duration || 0,
      is_transaction: span.is_transaction || false,
      children,
      level,
    };
  }

  const rootSpans = actualSpans.map((span: any) => convertSpan(span, 0));

  const fakeRoot: SelectedSpan = {
    event_id: traceId,
    op: "trace",
    name: null,
    description: `Trace ${traceId.substring(0, 8)}`,
    duration: 0,
    is_transaction: false,
    children: rootSpans,
    level: -1,
  };

  return [fakeRoot];
}
