/**
 * Pure fixture exports without MSW dependencies.
 *
 * Use this module in environments where MSW is not available (e.g., Cloudflare Workers).
 * For MSW mocking, import from the main package entry point instead.
 */

// Import JSON fixtures
import autofixStateFixture from "./fixtures/autofix-state.json" with {
  type: "json",
};
import issueFixture from "./fixtures/issue.json" with { type: "json" };
import eventsFixture from "./fixtures/event.json" with { type: "json" };
import performanceEventFixture from "./fixtures/performance-event.json" with {
  type: "json",
};
import eventAttachmentsFixture from "./fixtures/event-attachments.json" with {
  type: "json",
};
import tagsFixture from "./fixtures/tags.json" with { type: "json" };
import projectFixture from "./fixtures/project.json" with { type: "json" };
import teamFixture from "./fixtures/team.json" with { type: "json" };
import traceItemsAttributesFixture from "./fixtures/trace-items-attributes.json" with {
  type: "json",
};
import traceItemsAttributesSpansStringFixture from "./fixtures/trace-items-attributes-spans-string.json" with {
  type: "json",
};
import traceItemsAttributesSpansNumberFixture from "./fixtures/trace-items-attributes-spans-number.json" with {
  type: "json",
};
import traceItemsAttributesLogsStringFixture from "./fixtures/trace-items-attributes-logs-string.json" with {
  type: "json",
};
import traceItemsAttributesLogsNumberFixture from "./fixtures/trace-items-attributes-logs-number.json" with {
  type: "json",
};
import traceMetaFixture from "./fixtures/trace-meta.json" with { type: "json" };
import traceMetaWithNullsFixture from "./fixtures/trace-meta-with-nulls.json" with {
  type: "json",
};
import traceFixture from "./fixtures/trace.json" with { type: "json" };
import traceMixedFixture from "./fixtures/trace-mixed.json" with {
  type: "json",
};
import traceEventFixture from "./fixtures/trace-event.json" with {
  type: "json",
};
import organizationFixture from "./fixtures/organization.json" with {
  type: "json",
};
import releaseFixture from "./fixtures/release.json" with { type: "json" };
import clientKeyFixture from "./fixtures/client-key.json" with { type: "json" };
import userFixture from "./fixtures/user.json" with { type: "json" };
import eventsErrorsFixture from "./fixtures/events-errors.json" with {
  type: "json",
};
import eventsErrorsEmptyFixture from "./fixtures/events-errors-empty.json" with {
  type: "json",
};
import eventsSpansFixture from "./fixtures/events-spans.json" with {
  type: "json",
};
import eventsSpansEmptyFixture from "./fixtures/events-spans-empty.json" with {
  type: "json",
};

// Export all fixtures
export {
  autofixStateFixture,
  issueFixture,
  eventsFixture,
  performanceEventFixture,
  eventAttachmentsFixture,
  tagsFixture,
  projectFixture,
  teamFixture,
  traceItemsAttributesFixture,
  traceItemsAttributesSpansStringFixture,
  traceItemsAttributesSpansNumberFixture,
  traceItemsAttributesLogsStringFixture,
  traceItemsAttributesLogsNumberFixture,
  traceMetaFixture,
  traceMetaWithNullsFixture,
  traceFixture,
  traceMixedFixture,
  traceEventFixture,
  organizationFixture,
  releaseFixture,
  clientKeyFixture,
  userFixture,
  eventsErrorsFixture,
  eventsErrorsEmptyFixture,
  eventsSpansFixture,
  eventsSpansEmptyFixture,
};

// Re-export fixture factories
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
} from "./fixtures";
