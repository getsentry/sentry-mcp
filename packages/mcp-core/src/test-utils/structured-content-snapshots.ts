interface StructuredPreview<T> {
  data: T;
  truncated: boolean;
}

interface StructuredIssueContent {
  schemaVersion: string;
  security: {
    note: string;
  };
  meta: unknown;
  links: {
    issue: string;
    trace: string | null;
    replays: string[];
  };
  issue: {
    shortId: string;
    title: string;
    status: string;
    substatus: string | null;
    type: unknown;
    issueType: string | null;
    issueCategory: string | null;
    platform: string | null;
    project: {
      slug: string;
    };
    counts: unknown;
    timestamps: unknown;
  };
  event: {
    id: string;
    type: unknown;
    title: string;
    message: string | null;
    platform: string | null;
    dateCreated: string | null;
    dateReceived: string | null;
    entries: StructuredPreview<unknown[]>;
    contexts: StructuredPreview<Record<string, unknown>>;
    context: StructuredPreview<Record<string, unknown>>;
    tags: StructuredPreview<Array<{ key: string; value: string | null }>>;
    user: StructuredPreview<Record<string, unknown> | null>;
    occurrence: StructuredPreview<Record<string, unknown> | null>;
  };
  related: {
    autofixState: StructuredPreview<unknown>;
    externalIssues: unknown[];
    replayIds: string[];
    performanceTrace: unknown;
  };
}

export function toIssueDetailsStructuredContentSnapshot(content: unknown) {
  const structuredContent = content as StructuredIssueContent;

  return {
    schemaVersion: structuredContent.schemaVersion,
    security: structuredContent.security,
    meta: structuredContent.meta,
    links: {
      issue: structuredContent.links.issue,
      trace: structuredContent.links.trace,
      replayCount: structuredContent.links.replays.length,
    },
    issue: {
      shortId: structuredContent.issue.shortId,
      title: structuredContent.issue.title,
      status: structuredContent.issue.status,
      substatus: structuredContent.issue.substatus,
      type: structuredContent.issue.type,
      issueType: structuredContent.issue.issueType,
      issueCategory: structuredContent.issue.issueCategory,
      platform: structuredContent.issue.platform,
      projectSlug: structuredContent.issue.project.slug,
      counts: structuredContent.issue.counts,
      timestamps: structuredContent.issue.timestamps,
    },
    event: {
      id: structuredContent.event.id,
      type: structuredContent.event.type,
      title: structuredContent.event.title,
      message: structuredContent.event.message,
      platform: structuredContent.event.platform,
      dateCreated: structuredContent.event.dateCreated,
      dateReceived: structuredContent.event.dateReceived,
      entries: {
        truncated: structuredContent.event.entries.truncated,
        types: structuredContent.event.entries.data.map(getEntryType),
      },
      contexts: {
        truncated: structuredContent.event.contexts.truncated,
        keys: Object.keys(structuredContent.event.contexts.data),
      },
      context: {
        truncated: structuredContent.event.context.truncated,
        keys: Object.keys(structuredContent.event.context.data),
      },
      tags: {
        truncated: structuredContent.event.tags.truncated,
        keys: structuredContent.event.tags.data.map((tag) => tag.key),
      },
      user: {
        truncated: structuredContent.event.user.truncated,
        keys: getObjectKeys(structuredContent.event.user.data),
      },
      occurrence: {
        truncated: structuredContent.event.occurrence.truncated,
        keys: getObjectKeys(structuredContent.event.occurrence.data),
      },
    },
    related: {
      autofixState: {
        present: structuredContent.related.autofixState.data !== null,
        truncated: structuredContent.related.autofixState.truncated,
        keys: getObjectKeys(structuredContent.related.autofixState.data),
      },
      externalIssueCount: structuredContent.related.externalIssues.length,
      replayIds: structuredContent.related.replayIds,
      performanceTrace: toPerformanceTraceSnapshot(
        structuredContent.related.performanceTrace,
      ),
    },
  };
}

function getEntryType(entry: unknown): unknown {
  if (!isRecord(entry)) {
    return null;
  }
  return entry.type ?? null;
}

function getObjectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function toPerformanceTraceSnapshot(trace: unknown): unknown {
  if (!isRecord(trace)) {
    return trace;
  }

  return {
    rootCount: trace.rootCount,
    spanCount: trace.spanCount,
    issueCount: trace.issueCount,
    truncated: trace.truncated,
    rootPreview: Array.isArray(trace.rootPreview)
      ? trace.rootPreview.map(toTraceNodeSnapshot)
      : [],
  };
}

function toTraceNodeSnapshot(node: unknown): unknown {
  if (!isRecord(node)) {
    return null;
  }

  return {
    type: node.type,
    spanId: node.spanId,
    projectSlug: node.projectSlug,
    operation: node.operation,
    description: node.description,
    childCount: node.childCount,
    truncated: node.truncated,
    childPreview: Array.isArray(node.childPreview)
      ? node.childPreview.map(toTraceNodeSnapshot)
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
