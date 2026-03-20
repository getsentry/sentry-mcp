/**
 * Pure fixture exports without MSW dependencies.
 *
 * Use this module when tests need fixture data or factories without the mock
 * server entrypoint.
 */
import autofixStateFixture from "./fixtures/autofix-state.json" with {
  type: "json",
};
import eventAttachmentsFixture from "./fixtures/event-attachments.json" with {
  type: "json",
};
import eventFixture from "./fixtures/event.json" with { type: "json" };
import flamegraphFixture from "./fixtures/flamegraph.json" with {
  type: "json",
};
import issueFixture from "./fixtures/issue.json" with { type: "json" };
import issueTagValuesFixture from "./fixtures/issue-tag-values.json" with {
  type: "json",
};
import performanceEventFixture from "./fixtures/performance-event.json" with {
  type: "json",
};
import projectFixture from "./fixtures/project.json" with { type: "json" };
import replayDetailsFixture from "./fixtures/replay-details.json" with {
  type: "json",
};
import replayRecordingSegmentsFixture from "./fixtures/replay-recording-segments.json" with {
  type: "json",
};
import tagsFixture from "./fixtures/tags.json" with { type: "json" };
import teamFixture from "./fixtures/team.json" with { type: "json" };
import traceEventFixture from "./fixtures/trace-event.json" with {
  type: "json",
};
import traceItemsAttributesLogsNumberFixture from "./fixtures/trace-items-attributes-logs-number.json" with {
  type: "json",
};
import traceItemsAttributesLogsStringFixture from "./fixtures/trace-items-attributes-logs-string.json" with {
  type: "json",
};
import traceItemsAttributesSpansNumberFixture from "./fixtures/trace-items-attributes-spans-number.json" with {
  type: "json",
};
import traceItemsAttributesSpansStringFixture from "./fixtures/trace-items-attributes-spans-string.json" with {
  type: "json",
};
import traceItemsAttributesFixture from "./fixtures/trace-items-attributes.json" with {
  type: "json",
};
import traceMetaWithNullsFixture from "./fixtures/trace-meta-with-nulls.json" with {
  type: "json",
};
import traceMetaFixture from "./fixtures/trace-meta.json" with { type: "json" };
import traceMixedFixture from "./fixtures/trace-mixed.json" with {
  type: "json",
};
import traceFixture from "./fixtures/trace.json" with { type: "json" };

export {
  autofixStateFixture,
  eventAttachmentsFixture,
  eventFixture,
  flamegraphFixture,
  issueFixture,
  issueTagValuesFixture,
  performanceEventFixture,
  projectFixture,
  replayDetailsFixture,
  replayRecordingSegmentsFixture,
  tagsFixture,
  teamFixture,
  traceEventFixture,
  traceItemsAttributesFixture,
  traceItemsAttributesSpansStringFixture,
  traceItemsAttributesSpansNumberFixture,
  traceItemsAttributesLogsStringFixture,
  traceItemsAttributesLogsNumberFixture,
  traceMetaFixture,
  traceMetaWithNullsFixture,
  traceFixture,
  traceMixedFixture,
};

export {
  createDefaultEvent,
  createGenericEvent,
  createUnknownEvent,
  createPerformanceEvent,
  createPerformanceIssue,
  createRegressedIssue,
  createUnsupportedIssue,
  createCspIssue,
  createCspEvent,
  createFeedbackIssue,
} from "./fixtures";
