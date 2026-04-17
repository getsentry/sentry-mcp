import { transactionProfileV1Fixture } from "@sentry/mcp-server-mocks";
import { describe, expect, it } from "vitest";
import { TransactionProfileSchema } from "../../api-client/schema";
import type {
  Flamegraph,
  ProfileChunk,
  TransactionProfile,
} from "../../api-client/types";
import {
  formatFlamegraphAnalysis,
  formatFlamegraphComparison,
  formatProfileChunkAnalysis,
  formatTransactionProfileAnalysis,
} from "./formatter";

/**
 * Mock flamegraph fixture for testing formatters.
 */
function createMockFlamegraph(overrides: Partial<Flamegraph> = {}): Flamegraph {
  return {
    activeProfileIndex: 0,
    platform: "python",
    projectID: 123,
    transactionName: "/api/users",
    profiles: [
      {
        endValue: 100,
        isMainThread: true,
        name: "main",
        samples: [
          [0, 1, 2],
          [0, 1],
        ],
        sample_counts: [50, 30],
        sample_durations_ns: [100_000_000, 60_000_000],
        weights: [100, 60],
        startValue: 0,
        threadID: "main",
        type: "sampled",
        unit: "nanoseconds",
      },
    ],
    shared: {
      frames: [
        {
          file: "main.py",
          name: "handle_request",
          line: 10,
          is_application: true,
          fingerprint: 1001,
        },
        {
          file: "utils.py",
          name: "fetch_data",
          line: 25,
          is_application: true,
          fingerprint: 1002,
        },
        {
          file: "psycopg2/pool.py",
          name: "execute",
          line: 100,
          is_application: false,
          fingerprint: 1003,
        },
      ],
      frame_infos: [
        {
          count: 80,
          weight: 160,
          sumDuration: 160_000_000,
          sumSelfTime: 0,
          p75Duration: 50_000_000,
          p95Duration: 80_000_000,
          p99Duration: 120_000_000,
        },
        {
          count: 80,
          weight: 160,
          sumDuration: 160_000_000,
          sumSelfTime: 20_000_000,
          p75Duration: 40_000_000,
          p95Duration: 70_000_000,
          p99Duration: 100_000_000,
        },
        {
          count: 50,
          weight: 100,
          sumDuration: 100_000_000,
          sumSelfTime: 100_000_000,
          p75Duration: 50_000_000,
          p95Duration: 90_000_000,
          p99Duration: 200_000_000,
        },
      ],
      profiles: [
        {
          profile_id: "profile-abc123",
          transaction_id: "txn-456",
          timestamp: Date.now(),
        },
      ],
    },
    ...overrides,
  } as Flamegraph;
}

/**
 * Mock profile chunk fixture for testing.
 */
function createMockProfileChunk(): ProfileChunk {
  return {
    chunk_id: "chunk-abc123",
    profiler_id: "profiler-xyz789",
    platform: "python",
    release: "1.0.0",
    version: "1",
    environment: "production",
    profile: {
      frames: [
        {
          filename: "main.py",
          function: "handle_request",
          in_app: true,
          lineno: 10,
        },
        {
          filename: "utils.py",
          function: "fetch_data",
          in_app: true,
          lineno: 25,
        },
        {
          filename: "psycopg2/pool.py",
          function: "execute",
          in_app: false,
          lineno: 100,
        },
      ],
      samples: [
        { stack_id: 0, thread_id: "1", timestamp: 1000 },
        { stack_id: 0, thread_id: "1", timestamp: 2000 },
        { stack_id: 1, thread_id: "2", timestamp: 3000 },
      ],
      stacks: [
        [0, 1, 2],
        [0, 1],
      ],
      thread_metadata: {
        "1": { name: "main" },
        "2": { name: "worker" },
      },
    },
  } as ProfileChunk;
}

function createMockTransactionProfile(): TransactionProfile {
  // Parse the fixture through the schema so transforms run (e.g. normalizing
  // numeric thread_id and active_thread_id to strings). This keeps test
  // fixtures in sync with what production code actually receives after the
  // API client validates the response.
  return TransactionProfileSchema.parse(
    structuredClone(transactionProfileV1Fixture),
  );
}

describe("formatter", () => {
  describe("formatFlamegraphAnalysis", () => {
    it("includes transaction information", () => {
      const flamegraph = createMockFlamegraph();
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      expect(output).toContain("# Profile Analysis: /api/users");
      expect(output).toContain("**Transaction**: /api/users");
      expect(output).toContain("**Project ID**: 123");
      expect(output).toContain("**Platform**: python");
    });

    it("includes performance summary", () => {
      const flamegraph = createMockFlamegraph();
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      expect(output).toContain("## Performance Summary");
      expect(output).toContain("### Code Breakdown");
      expect(output).toContain("Total User Code Time");
      expect(output).toContain("Total Library Time");
    });

    it("includes top slow functions table", () => {
      const flamegraph = createMockFlamegraph();
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      expect(output).toContain("### Top Slow Functions");
      expect(output).toContain("| Function | File:Line |");
      expect(output).toContain("`handle_request`");
      expect(output).toContain("`fetch_data`");
    });

    it("includes hot paths section", () => {
      const flamegraph = createMockFlamegraph();
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: false,
        maxHotPaths: 5,
      });

      expect(output).toContain("## Top Hot Paths");
      expect(output).toContain("### Path #1:");
      expect(output).toContain("samples");
    });

    it("falls back to thread profiles when shared profile metadata is omitted", () => {
      const flamegraph = createMockFlamegraph({
        shared: {
          ...createMockFlamegraph().shared,
          profiles: [],
        },
      });
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: false,
        maxHotPaths: 5,
      });

      expect(output).toContain("**Total Profiles**: 1");
      expect(output).toContain("across 1 profiles");
    });

    it("includes actionable next steps", () => {
      const flamegraph = createMockFlamegraph();
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      expect(output).toContain("## Actionable Next Steps");
      expect(output).toContain("### Immediate Actions");
      expect(output).toContain("Compare with baseline");
    });

    it("respects focusOnUserCode option in hot paths", () => {
      const flamegraph = createMockFlamegraph();
      const outputUserCode = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      const outputAll = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: false,
        maxHotPaths: 5,
      });

      // User code output should show [YOUR CODE] markers
      expect(outputUserCode).toContain("[YOUR CODE]");

      // All code output should include library code
      expect(outputAll).toContain("psycopg2");
    });
  });

  describe("formatFlamegraphComparison", () => {
    it("includes comparison summary", () => {
      const baseline = createMockFlamegraph();
      const current = createMockFlamegraph();

      const output = formatFlamegraphComparison(baseline, current, {
        focusOnUserCode: false,
      });

      expect(output).toContain("# Profile Comparison: /api/users");
      expect(output).toContain("## Summary");
      expect(output).toContain("**Status**:");
    });

    it("shows 'No Significant Changes' when similar", () => {
      const baseline = createMockFlamegraph();
      const current = createMockFlamegraph();

      const output = formatFlamegraphComparison(baseline, current, {
        focusOnUserCode: false,
      });

      expect(output).toContain("No Significant Changes");
    });

    it("detects and reports major regressions", () => {
      const baseline = createMockFlamegraph();
      const current = createMockFlamegraph();

      // Make current 50% slower (comparison uses sumDuration, not weight)
      current.shared.frame_infos[0].sumDuration = 240000000;

      const output = formatFlamegraphComparison(baseline, current, {
        focusOnUserCode: false,
      });

      expect(output).toContain("Regression Detected");
      expect(output).toContain("## Major Regressions Detected");
      expect(output).toContain("`handle_request`");
    });

    it("includes key changes table", () => {
      const baseline = createMockFlamegraph();
      const current = createMockFlamegraph();

      const output = formatFlamegraphComparison(baseline, current, {
        focusOnUserCode: false,
      });

      expect(output).toContain("## Key Changes");
      expect(output).toContain(
        "| Function | File:Line | Baseline | Current | Change | Status |",
      );
    });

    it("shows improvement status when performance improves", () => {
      const baseline = createMockFlamegraph();
      const current = createMockFlamegraph();

      // Make current 20% faster (comparison uses sumDuration, not weight)
      current.shared.frame_infos[0].sumDuration = 128000000;
      current.shared.frame_infos[1].sumDuration = 128000000;
      current.shared.frame_infos[2].sumDuration = 80000000;

      const output = formatFlamegraphComparison(baseline, current, {
        focusOnUserCode: false,
      });

      expect(output).toContain("Improvement");
    });
  });

  describe("formatProfileChunkAnalysis", () => {
    it("includes chunk metadata", () => {
      const chunk = createMockProfileChunk();
      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: false,
      });

      expect(output).toContain("# Profile Chunk Details");
      expect(output).toContain("**Chunk ID**: chunk-abc123");
      expect(output).toContain("**Profiler ID**: profiler-xyz789");
      expect(output).toContain("**Platform**: python");
      expect(output).toContain("**Release**: 1.0.0");
      expect(output).toContain("**Environment**: production");
    });

    it("includes sample summary", () => {
      const chunk = createMockProfileChunk();
      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: false,
      });

      expect(output).toContain("## Sample Summary");
      expect(output).toContain("**Total Frames**: 3");
      expect(output).toContain("**Total Samples**: 3");
      expect(output).toContain("**Total Stacks**: 2");
      expect(output).toContain("**Threads**: 2");
    });

    it("includes thread information", () => {
      const chunk = createMockProfileChunk();
      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: false,
      });

      expect(output).toContain("## Thread Information");
      expect(output).toContain("**Thread 1**: main");
      expect(output).toContain("**Thread 2**: worker");
    });

    it("includes top frames by occurrence", () => {
      const chunk = createMockProfileChunk();
      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: false,
      });

      expect(output).toContain("## Top Frames by Occurrence");
      expect(output).toContain("| Function | File:Line | Count | Type |");
      expect(output).toContain("`handle_request`");
    });

    it("filters to user code when requested", () => {
      const chunk = createMockProfileChunk();
      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: true,
      });

      // Library frame should not appear in table
      expect(output).not.toContain("`execute`");
    });

    it("shows class_name.function for Java/Android frames", () => {
      const chunk = createMockProfileChunk();
      chunk.profile.frames.push({
        filename: "UserService.java",
        function: "getUsers",
        in_app: true,
        lineno: 87,
        class_name: "UserService",
      });
      // Add a stack referencing the new frame
      chunk.profile.stacks.push([3]);
      chunk.profile.samples.push({
        stack_id: 2,
        thread_id: "1",
        timestamp: 4000,
      });

      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: false,
      });

      expect(output).toContain("`UserService.getUsers`");
    });

    it("falls back to module when filename is absent", () => {
      const chunk = createMockProfileChunk();
      chunk.profile.frames.push({
        filename: null,
        function: "native_call",
        in_app: false,
        lineno: null,
        module: "libc.so",
      });
      chunk.profile.stacks.push([3]);
      chunk.profile.samples.push({
        stack_id: 2,
        thread_id: "1",
        timestamp: 4000,
      });

      const output = formatProfileChunkAnalysis(chunk, {
        focusOnUserCode: false,
      });

      expect(output).toContain("libc.so");
    });
  });

  describe("formatTransactionProfileAnalysis", () => {
    it("counts frame occurrences from samples instead of unique stack definitions", () => {
      const profile = createMockTransactionProfile();

      const output = formatTransactionProfileAnalysis(profile, {
        focusOnUserCode: true,
        profileUrl:
          "https://sentry-mcp-evals.sentry.io/explore/profiling/profile/backend/cfe78a5c892d4a64a962d837673398d2/flamegraph/",
        projectSlug: "backend",
        traceUrl:
          "https://sentry-mcp-evals.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
      });

      expect(output).toContain(
        "| `handle_request` | main.py:42 | 3 | User Code |",
      );
      expect(output).toContain(
        "| `execute_query` | db.py:118 | 2 | User Code |",
      );
    });

    it("filters to user code before limiting hotspot rows", () => {
      const profile = createMockTransactionProfile();

      profile.profile.frames = [
        ...Array.from({ length: 11 }, (_, index) => ({
          filename: `vendor_${index}.py`,
          function: `library_${index}`,
          in_app: false,
          lineno: index + 1,
          module: `vendor.module_${index}`,
          abs_path: `/usr/lib/vendor_${index}.py`,
          platform: "python",
          lang: "python",
        })),
        {
          filename: "app.py",
          function: "app_handler",
          in_app: true,
          lineno: 99,
          module: "app.handlers",
          abs_path: "/app/src/app.py",
          platform: "python",
          lang: "python",
        },
      ];
      profile.profile.stacks = profile.profile.frames.map((_, index) => [
        index,
      ]);
      profile.profile.samples = [
        ...Array.from({ length: 22 }, (_, index) => ({
          stack_id: Math.floor(index / 2),
          thread_id: "1",
          elapsed_since_start_ns: index * 10_000_000,
        })),
        {
          stack_id: 11,
          thread_id: "1",
          elapsed_since_start_ns: 220_000_000,
        },
      ];

      const output = formatTransactionProfileAnalysis(profile, {
        focusOnUserCode: true,
        profileUrl:
          "https://sentry-mcp-evals.sentry.io/explore/profiling/profile/backend/cfe78a5c892d4a64a962d837673398d2/flamegraph/",
        projectSlug: "backend",
      });

      expect(output).toContain("## Top Frames by Occurrence");
      expect(output).toContain("| `app_handler` | app.py:99 | 1 | User Code |");
      expect(output).not.toContain("`library_0`");
    });

    it("falls back to elapsed_since_start_ns for V1 transaction profiles when relative bounds are missing", () => {
      // Regression test for getsentry/sentry-mcp issue MCP-SERVER-FRN: vroom
      // emits V1 samples with elapsed_since_start_ns (uint64 nanoseconds)
      // instead of timestamp, and numeric thread_id.
      const profile = createMockTransactionProfile();

      if (profile.transaction) {
        profile.transaction.relative_start_ns = undefined;
        profile.transaction.relative_end_ns = undefined;
      }

      profile.profile.samples = [
        { stack_id: 0, thread_id: "1", elapsed_since_start_ns: 0 },
        { stack_id: 1, thread_id: "1", elapsed_since_start_ns: 50_000_000 },
        { stack_id: 1, thread_id: "1", elapsed_since_start_ns: 100_000_000 },
      ];

      const output = formatTransactionProfileAnalysis(profile, {
        focusOnUserCode: true,
        profileUrl:
          "https://sentry-mcp-evals.sentry.io/explore/profiling/profile/backend/cfe78a5c892d4a64a962d837673398d2/flamegraph/",
        projectSlug: "backend",
      });

      expect(output).toContain("- **Duration**: 100ms");
    });

    it("preserves sub-millisecond V1 sample durations", () => {
      const profile = createMockTransactionProfile();

      if (profile.transaction) {
        profile.transaction.relative_start_ns = undefined;
        profile.transaction.relative_end_ns = undefined;
      }

      profile.profile.samples = [
        { stack_id: 0, thread_id: "1", elapsed_since_start_ns: 0 },
        { stack_id: 1, thread_id: "1", elapsed_since_start_ns: 250_000 },
        { stack_id: 1, thread_id: "1", elapsed_since_start_ns: 500_000 },
      ];

      const output = formatTransactionProfileAnalysis(profile, {
        focusOnUserCode: true,
        profileUrl:
          "https://sentry-mcp-evals.sentry.io/explore/profiling/profile/backend/cfe78a5c892d4a64a962d837673398d2/flamegraph/",
        projectSlug: "backend",
      });

      expect(output).toContain("- **Duration**: 500µs");
    });
  });

  describe("edge cases", () => {
    it("handles empty profiles gracefully", () => {
      const flamegraph = createMockFlamegraph({ profiles: [] });
      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      expect(output).toContain("Profile Analysis:");
      expect(output).toContain("No significant hot paths found");
    });

    it("handles empty frames gracefully", () => {
      const flamegraph = createMockFlamegraph();
      flamegraph.shared.frames = [];
      flamegraph.shared.frame_infos = [];

      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      // Should not throw and should produce output
      expect(typeof output).toBe("string");
    });

    it("handles missing optional fields", () => {
      const flamegraph = createMockFlamegraph({ transactionName: undefined });

      const output = formatFlamegraphAnalysis(flamegraph, {
        focusOnUserCode: true,
        maxHotPaths: 5,
      });

      expect(output).toContain("Unknown Transaction");
    });
  });
});
