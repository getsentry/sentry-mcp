import { describe, it, expect } from "vitest";
import { formatIssueResults } from "./formatters.js";
import {
  createPerformanceIssue,
  createFeedbackIssue,
} from "@sentry/mcp-server-mocks";

describe("formatIssueResults", () => {
  const baseParams = {
    organizationSlug: "test-org",
    regionUrl: "https://sentry.io",
  };

  describe("issueCategory display", () => {
    it("displays category for feedback issues", () => {
      const feedbackIssue = createFeedbackIssue({
        shortId: "TEST-FEEDBACK-1",
        title: "User Feedback: Login broken",
        status: "unresolved",
        userCount: 1,
        count: "1",
        firstSeen: "2025-01-01T00:00:00Z",
        lastSeen: "2025-01-01T00:00:00Z",
        issueCategory: "feedback",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [feedbackIssue],
      });

      expect(result).toContain("**Category**: feedback");
    });

    it("displays category for performance issues", () => {
      const perfIssue = createPerformanceIssue({
        shortId: "TEST-PERF-1",
        title: "N+1 Query",
        status: "unresolved",
        userCount: 10,
        count: "100",
        firstSeen: "2025-01-01T00:00:00Z",
        lastSeen: "2025-01-01T00:00:00Z",
        issueCategory: "performance",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [perfIssue],
      });

      expect(result).toContain("**Category**: performance");
    });

    it("does not display category for error issues", () => {
      const errorIssue = createFeedbackIssue({
        shortId: "TEST-ERROR-1",
        title: "TypeError: Cannot read property",
        status: "unresolved",
        userCount: 5,
        count: "50",
        firstSeen: "2025-01-01T00:00:00Z",
        lastSeen: "2025-01-01T00:00:00Z",
        issueCategory: "error",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [errorIssue],
      });

      expect(result).not.toContain("**Category**:");
    });

    it("does not display category when issueCategory is undefined", () => {
      const issue = createFeedbackIssue({
        shortId: "TEST-1",
        title: "Some Issue",
        status: "unresolved",
        userCount: 1,
        count: "1",
        firstSeen: "2025-01-01T00:00:00Z",
        lastSeen: "2025-01-01T00:00:00Z",
        issueCategory: undefined,
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [issue],
      });

      expect(result).not.toContain("**Category**:");
    });
  });

  describe("feedback-specific guidance", () => {
    it("includes feedback guidance when results contain feedback issues", () => {
      const feedbackIssue = createFeedbackIssue({
        shortId: "TEST-FEEDBACK-2",
        title: "User Feedback: Page not loading",
        issueCategory: "feedback",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [feedbackIssue],
      });

      expect(result).toContain(
        "View feedback details: Use get_issue_details to see full feedback content and linked error events",
      );
    });

    it("does not include feedback guidance for non-feedback issues", () => {
      const errorIssue = createPerformanceIssue({
        shortId: "TEST-ERROR-2",
        title: "N+1 Query",
        issueCategory: "performance",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [errorIssue],
      });

      expect(result).not.toContain("View feedback details:");
    });

    it("includes feedback guidance when mixed issues contain at least one feedback", () => {
      const errorIssue = createPerformanceIssue({
        shortId: "TEST-ERROR-3",
        title: "N+1 Query",
        issueCategory: "performance",
      });
      const feedbackIssue = createFeedbackIssue({
        shortId: "TEST-FEEDBACK-3",
        title: "User Feedback: Bug report",
        issueCategory: "feedback",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [errorIssue, feedbackIssue],
      });

      expect(result).toContain("View feedback details:");
    });
  });

  describe("empty results", () => {
    it("handles empty issue list gracefully", () => {
      const result = formatIssueResults({
        ...baseParams,
        issues: [],
        naturalLanguageQuery: "user feedback",
      });

      expect(result).toContain("No issues found matching your search criteria");
      expect(result).not.toContain("View feedback details:");
    });
  });

  describe("seer fixability score", () => {
    it("displays fixability score when present", () => {
      const issue = createPerformanceIssue({
        shortId: "TEST-1",
        seerFixabilityScore: 0.8,
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [issue],
      });

      expect(result).toContain("**Seer Actionability**: super_high");
    });

    it("does not display fixability when not present", () => {
      const issue = createPerformanceIssue({
        shortId: "TEST-1",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [issue],
      });

      expect(result).not.toContain("Seer Actionability");
    });

    it("displays correct label for different score thresholds", () => {
      const highIssue = createPerformanceIssue({
        shortId: "TEST-HIGH",
        seerFixabilityScore: 0.7,
      });
      const mediumIssue = createPerformanceIssue({
        shortId: "TEST-MED",
        seerFixabilityScore: 0.5,
      });
      const lowIssue = createPerformanceIssue({
        shortId: "TEST-LOW",
        seerFixabilityScore: 0.3,
      });

      const highResult = formatIssueResults({
        ...baseParams,
        issues: [highIssue],
      });
      const mediumResult = formatIssueResults({
        ...baseParams,
        issues: [mediumIssue],
      });
      const lowResult = formatIssueResults({
        ...baseParams,
        issues: [lowIssue],
      });

      expect(highResult).toContain("**Seer Actionability**: high");
      expect(mediumResult).toContain("**Seer Actionability**: medium");
      expect(lowResult).toContain("**Seer Actionability**: low");
    });
  });

  describe("output format", () => {
    it("formats feedback issue correctly", () => {
      const feedbackIssue = createFeedbackIssue({
        shortId: "PROJ-FB-1",
        title: "User Feedback: Checkout broken",
        status: "unresolved",
        userCount: 1,
        count: "1",
        firstSeen: "2025-01-01T00:00:00Z",
        lastSeen: "2025-01-01T00:00:00Z",
        issueCategory: "feedback",
        culprit: "User Feedback Widget",
      });

      const result = formatIssueResults({
        ...baseParams,
        issues: [feedbackIssue],
        naturalLanguageQuery: "show me user feedback",
      });

      expect(result).toMatchInlineSnapshot(`
        "# Search Results for "show me user feedback"

        ⚠️ **IMPORTANT**: Display these issues as highlighted cards with status indicators, assignee info, and clickable Issue IDs.

        **View these results in Sentry**:
        https://test-org.sentry.io/issues/
        _Please share this link with the user to view the search results in their Sentry dashboard._

        Found **1** issue:

        ## 1. [PROJ-FB-1](https://test-org.sentry.io/issues/PROJ-FB-1)

        **User Feedback: Checkout broken**

        - **Status**: unresolved
        - **Category**: feedback
        - **Users**: 1
        - **Events**: 1
        - **First seen**: 2025-01-01
        - **Last seen**: 2025-01-01
        - **Culprit**: \`User Feedback Widget\`

        ## Next Steps

        - Get more details about a specific issue: Use the Issue ID with get_issue_details
        - Update issue status: Use update_issue to resolve or assign issues
        - View event counts: Use search_events for aggregated statistics
        - View feedback details: Use get_issue_details to see full feedback content and linked error events
        "
      `);
    });
  });
});
