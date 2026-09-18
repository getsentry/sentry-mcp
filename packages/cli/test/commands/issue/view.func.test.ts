/**
 * Tests for the issue view command's replay integration.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../src/commands/issue/utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/commands/issue/utils.js")
    >();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as issueUtils from "../../../src/commands/issue/utils.js";
import { viewCommand } from "../../../src/commands/issue/view.js";

vi.mock("../../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../src/lib/api-client.js";
import type { SentryEvent, SentryIssue } from "../../../src/types/index.js";

const REPLAY_ID = "346789a703f6454384f1de473b8b9fcc";
const SECOND_REPLAY_ID = "aaaaaaaa03f6454384f1de473b8b9fcc";
const DASHED_REPLAY_ID = `${REPLAY_ID.slice(0, 8)}-${REPLAY_ID.slice(8, 12)}-${REPLAY_ID.slice(12, 16)}-${REPLAY_ID.slice(16, 20)}-${REPLAY_ID.slice(20)}`;

function sampleIssue(overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id: "12345",
    shortId: "CLI-123",
    title: "Replay-linked issue",
    permalink: "https://sentry.io/organizations/test-org/issues/12345/",
    ...overrides,
  };
}

function sampleEvent(overrides: Partial<SentryEvent> = {}): SentryEvent {
  return {
    eventID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    title: "Latest event",
    tags: [{ key: "replay.id", value: REPLAY_ID }],
    ...overrides,
  };
}

describe("issue view replay integration", () => {
  let resolveIssueSpy: ReturnType<typeof spyOn>;
  let getLatestEventSpy: ReturnType<typeof spyOn>;
  let listReplayIdsForIssueSpy: ReturnType<typeof spyOn>;

  function createMockContext() {
    const stdoutWrite = vi.fn(() => true);
    return {
      context: {
        stdout: { write: stdoutWrite },
        stderr: { write: vi.fn(() => true) },
        cwd: "/tmp",
      },
      stdoutWrite,
    };
  }

  beforeEach(() => {
    resolveIssueSpy = vi.spyOn(issueUtils, "resolveIssue");
    getLatestEventSpy = vi.spyOn(apiClient, "getLatestEvent");
    listReplayIdsForIssueSpy = vi.spyOn(apiClient, "listReplayIdsForIssue");
  });

  afterEach(() => {
    resolveIssueSpy.mockRestore();
    getLatestEventSpy.mockRestore();
    listReplayIdsForIssueSpy.mockRestore();
  });

  test("includes deduplicated replay IDs in JSON output", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: sampleIssue(),
    });
    getLatestEventSpy.mockResolvedValue(sampleEvent());
    listReplayIdsForIssueSpy.mockResolvedValue([
      DASHED_REPLAY_ID,
      SECOND_REPLAY_ID,
    ]);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: true, web: false, spans: 0, fresh: false },
      "CLI-123"
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.org).toBe("test-org");
    expect(parsed.replayIds).toEqual([REPLAY_ID, SECOND_REPLAY_ID]);
  });

  test("renders additional related replays in human output", async () => {
    resolveIssueSpy.mockResolvedValue({
      org: "test-org",
      issue: sampleIssue(),
    });
    getLatestEventSpy.mockResolvedValue(sampleEvent());
    listReplayIdsForIssueSpy.mockResolvedValue([REPLAY_ID, SECOND_REPLAY_ID]);

    const { context, stdoutWrite } = createMockContext();
    const func = await viewCommand.loader();
    await func.call(
      context,
      { json: false, web: false, spans: 0, fresh: false },
      "CLI-123"
    );

    const output = stdoutWrite.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("Related Replays");
    expect(output).toContain(SECOND_REPLAY_ID);
    expect(output).toContain(`sentry replay view test-org/${SECOND_REPLAY_ID}`);
  });
});
