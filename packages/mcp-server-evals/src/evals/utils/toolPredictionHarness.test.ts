import { describe, expect, it } from "vitest";
import type { Harness, HarnessRun } from "vitest-evals";
import { ToolPredictionJudge } from "./toolPredictionHarness";
import type { ToolPredictionMetadata, ToolPredictionOutput } from "./types";

function createJudgeContext(
  output: ToolPredictionOutput,
  metadata: ToolPredictionMetadata,
): Parameters<typeof ToolPredictionJudge.assess>[0] {
  const run: HarnessRun<ToolPredictionOutput> = {
    output,
    session: { messages: [] },
    usage: {},
    errors: [],
  };
  const harness: Harness<string, ToolPredictionOutput, ToolPredictionMetadata> =
    {
      name: "test-tool-prediction",
      run: async () => run,
    };

  return {
    input: "test input",
    output,
    toolCalls: [],
    metadata,
    run,
    session: run.session,
    harness,
  };
}

describe("ToolPredictionJudge", () => {
  it("scores matching predicted tools", async () => {
    const result = await ToolPredictionJudge.assess(
      createJudgeContext(
        {
          score: 1,
          rationale: "The task asks for accessible organizations.",
          predictedTools: [
            {
              name: "find_organizations",
              arguments: {},
            },
          ],
        },
        {
          expectedTools: [
            {
              name: "find_organizations",
              arguments: {},
            },
          ],
        },
      ),
    );

    expect(result.score).toBe(1);
    expect(result.metadata?.predictedTools).toEqual([
      {
        name: "find_organizations",
        arguments: {},
      },
    ]);
  });

  it("uses deterministic score when the model underrates matching tools", async () => {
    const result = await ToolPredictionJudge.assess(
      createJudgeContext(
        {
          score: 0,
          rationale: "The expected discovery call is not necessary.",
          predictedTools: [
            {
              name: "find_organizations",
              arguments: {},
            },
          ],
        },
        {
          expectedTools: [
            {
              name: "find_organizations",
              arguments: {},
            },
          ],
        },
      ),
    );

    expect(result.score).toBe(1);
    expect(result.metadata?.modelScore).toBe(0);
    expect(result.metadata?.deterministicScore).toBe(1);
  });

  it("scores wrong predicted tools as failures", async () => {
    const result = await ToolPredictionJudge.assess(
      createJudgeContext(
        {
          score: 0.8,
          rationale: "The prediction picked the wrong lookup path.",
          predictedTools: [
            {
              name: "find_organizations",
              arguments: {},
            },
          ],
        },
        {
          expectedTools: [
            {
              name: "search_docs",
              arguments: {
                query: "rate limiting",
              },
            },
          ],
        },
      ),
    );

    expect(result.score).toBe(0.8);
    expect(result.metadata?.rationale).toContain("wrong lookup path");
    expect(result.metadata?.deterministicRationale).toContain(
      "Partial match: 0/1",
    );
    expect(result.metadata?.deterministicScore).toBe(0);
  });

  it("preserves model scores for incomplete multi-step predictions", async () => {
    const result = await ToolPredictionJudge.assess(
      createJudgeContext(
        {
          score: 0.6,
          rationale: "The prediction found the issue but missed the update.",
          predictedTools: [
            {
              name: "search_issues",
              arguments: {
                organizationSlug: "sentry",
              },
            },
          ],
        },
        {
          expectedTools: [
            {
              name: "search_issues",
              arguments: {
                organizationSlug: "sentry",
              },
            },
            {
              name: "update_issue",
              arguments: {
                organizationSlug: "sentry",
              },
            },
          ],
        },
      ),
    );

    expect(result.score).toBe(0.6);
    expect(result.metadata?.rationale).toContain("missed the update");
    expect(result.metadata?.deterministicRationale).toContain("Partial match");
    expect(result.metadata?.deterministicScore).toBe(0.5);
  });
});
