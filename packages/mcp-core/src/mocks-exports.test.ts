import { describe, expect, it } from "vitest";
import { flamegraphFixture } from "@sentry/mcp-server-mocks";
import {
  createFeedbackIssue,
  flamegraphFixture as payloadFlamegraphFixture,
} from "@sentry/mcp-server-mocks/payloads";

describe("@sentry/mcp-server-mocks exports", () => {
  it("re-exports flamegraphFixture from the package entrypoint", () => {
    expect(flamegraphFixture).toBeDefined();
    expect(flamegraphFixture.projectID).toBe(4509062593708032);
    expect(flamegraphFixture.transactionName).toBe("/api/users");
  });

  it("re-exports pure fixtures and factories from the payloads entrypoint", () => {
    expect(payloadFlamegraphFixture).toBeDefined();

    const feedbackIssue = createFeedbackIssue({
      title: "User Feedback: Export regression",
    });

    expect(feedbackIssue.title).toBe("User Feedback: Export regression");
  });
});
