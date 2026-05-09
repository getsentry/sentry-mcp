import { describe, expect, it } from "vitest";

import {
  buildDuplicateClosureComment,
  hasIssueTriageBotIntro,
  TRIAGE_BOT_INTRO,
  wasClosedAsNotPlanned,
  withIssueTriageBotIntro,
} from "./issue-triage";

const duplicate = {
  number: 950,
  title: "rewrite in rust",
  url: "https://github.com/getsentry/sentry-mcp/issues/950",
  state: "CLOSED",
  confidence: "high" as const,
  reason: "same request",
};

describe("issue triage comments", () => {
  it("prepends an issue triage bot greeting when the model omits one", () => {
    expect(
      withIssueTriageBotIntro(
        "Thanks for the report. This appears to duplicate #950.",
      ),
    ).toBe(
      [
        TRIAGE_BOT_INTRO,
        "",
        "Thanks for the report. This appears to duplicate #950.",
      ].join("\n"),
    );
  });

  it("accepts varied wording when the first sentence identifies the bot", () => {
    const body =
      "Hello, I'm the issue triage bot.\n\nI cleaned this up for maintainers.";

    expect(hasIssueTriageBotIntro(body)).toBe(true);
    expect(withIssueTriageBotIntro(body)).toBe(body);
  });

  it("prepends the greeting when only a later sentence identifies the bot", () => {
    const body =
      "Thanks for the report. I'm the issue triage bot and found a duplicate.";

    expect(hasIssueTriageBotIntro(body)).toBe(false);
    expect(withIssueTriageBotIntro(body)).toBe(
      `${TRIAGE_BOT_INTRO}\n\n${body}`,
    );
  });
});

describe("duplicate closure", () => {
  it("inherits not planned when the canonical issue was closed as wontfix", () => {
    expect(
      wasClosedAsNotPlanned({
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
      }),
    ).toBe(true);
  });

  it("does not treat ordinary duplicate closure as not planned", () => {
    expect(
      wasClosedAsNotPlanned({
        state: "CLOSED",
        stateReason: "DUPLICATE",
      }),
    ).toBe(false);
  });

  it("explains not planned duplicate closure without using duplicate-only copy", () => {
    expect(buildDuplicateClosureComment(duplicate, true)).toContain(
      "already closed as not planned",
    );
  });
});
