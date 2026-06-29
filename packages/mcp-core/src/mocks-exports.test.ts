import { describe, expect, it } from "vitest";
import { flamegraphFixture } from "@sentry/mcp-server-mocks";
import {
  createFeedbackIssue,
  flamegraphFixture as payloadFlamegraphFixture,
} from "@sentry/mcp-server-mocks/payloads";
import { isLLMProviderRequest } from "@sentry/mcp-server-mocks/utils";

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

  it("identifies LLM provider requests ignored by MSW", () => {
    expect(isLLMProviderRequest("https://api.openai.com/v1/responses")).toBe(
      true,
    );
    expect(isLLMProviderRequest("https://api.anthropic.com/v1/messages")).toBe(
      true,
    );
    expect(
      isLLMProviderRequest("https://openrouter.ai/api/v1/chat/completions"),
    ).toBe(true);
    expect(
      isLLMProviderRequest("https://example.openai.azure.com/openai/v1/"),
    ).toBe(true);
    expect(
      isLLMProviderRequest(
        "https://example.openai.azure.com/openai/deployments/model/chat/completions",
      ),
    ).toBe(true);

    expect(isLLMProviderRequest("https://sentry.io/api/0/projects/")).toBe(
      false,
    );
    expect(isLLMProviderRequest("https://example.azure.com/openai/v1/")).toBe(
      false,
    );
  });
});
