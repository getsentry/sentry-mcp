import { describe, expect, it } from "vitest";
import { createEmbeddedSearchAgentHarness } from "./embeddedAgentHarness";

function createHarnessContext() {
  const artifacts = {};

  return {
    metadata: {},
    artifacts,
    setArtifact: () => {},
  };
}

describe("createEmbeddedSearchAgentHarness", () => {
  it("uses a fallback session when AI SDK steps lack harness model metadata", async () => {
    const harness = createEmbeddedSearchAgentHarness(
      "test-embedded-agent",
      async () => ({
        result: {
          query: "is:unresolved",
        },
        toolCalls: [
          {
            toolName: "whoami",
            args: {},
          },
        ],
        steps: [
          {
            usage: {
              inputTokens: 1,
              outputTokens: 2,
              totalTokens: 3,
            },
          },
        ],
        totalUsage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
        },
      }),
    );

    const run = await harness.run(
      "show unresolved issues",
      createHarnessContext(),
    );

    expect(run.output).toEqual({
      query: "is:unresolved",
    });
    expect(run.session.messages).toEqual([
      {
        role: "user",
        content: "show unresolved issues",
      },
      {
        role: "assistant",
        content: {
          query: "is:unresolved",
        },
        toolCalls: [
          {
            name: "whoami",
            arguments: {},
          },
        ],
      },
    ]);
    expect(run.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
  });
});
