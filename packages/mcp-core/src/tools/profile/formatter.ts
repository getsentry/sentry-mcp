/**
 * Formatting functions for profile analysis output.
 *
 * This module provides markdown formatting for profiling tool responses:
 * - Single transaction analysis (get_transaction_profile)
 * - Performance comparison (compare_transaction_profiles)
 * - Raw profile chunk analysis (get_profile_details)
 */

import type { Flamegraph, ProfileChunk } from "../../api-client/types";
import {
  analyzeHotPathsFromFlamegraph,
  compareFrameStats,
  formatDuration,
  formatPercentage,
  generatePerformanceInsights,
  identifyHotspotFramesFromFlamegraph,
  type FrameComparison,
  type HotPath,
} from "./analyzer";

/**
 * Maps a change type to its corresponding status icon.
 */
const CHANGE_TYPE_ICONS: Record<FrameComparison["changeType"], string> = {
  major_regression: "🚨",
  minor_regression: "⚠️",
  improvement: "✅",
  no_change: "➖",
};

/**
 * Options for flamegraph analysis formatting.
 */
export interface FlamegraphAnalysisOptions {
  focusOnUserCode: boolean;
  maxHotPaths: number;
}

/**
 * Options for flamegraph comparison formatting.
 */
export interface FlamegraphComparisonOptions {
  focusOnUserCode: boolean;
}

/**
 * Options for profile chunk formatting.
 */
export interface ProfileChunkAnalysisOptions {
  focusOnUserCode: boolean;
}

/**
 * Formats flamegraph analysis for a single transaction.
 *
 * Produces markdown output with:
 * - Transaction information
 * - Performance summary (user code vs library)
 * - Top slow functions table
 * - Hot paths with recommendations
 * - Actionable next steps
 *
 * @param flamegraph Flamegraph data from API
 * @param options Formatting options
 * @returns Markdown-formatted analysis
 */
export function formatFlamegraphAnalysis(
  flamegraph: Flamegraph,
  options: FlamegraphAnalysisOptions,
): string {
  const sections: string[] = [];

  // Transaction information
  sections.push(formatTransactionInfo(flamegraph));

  // Performance summary
  sections.push(formatPerformanceSummary(flamegraph, options));

  // Hot paths
  const hotPaths = analyzeHotPathsFromFlamegraph(flamegraph, options);
  sections.push(formatHotPaths(hotPaths, flamegraph, options));

  // Actionable next steps
  sections.push(formatActionableSteps(hotPaths, flamegraph));

  return sections.join("\n\n");
}

/**
 * Formats transaction information section.
 */
function formatTransactionInfo(flamegraph: Flamegraph): string {
  const profile = flamegraph.profiles[0];
  const totalSamples = profile?.sample_counts.reduce((a, b) => a + b, 0) || 0;
  const totalDuration =
    profile?.sample_durations_ns.reduce((a, b) => a + b, 0) || 0;

  return [
    `# Profile Analysis: ${flamegraph.transactionName || "Unknown Transaction"}`,
    "",
    "## Transaction Information",
    `- **Transaction**: ${flamegraph.transactionName || "Unknown"}`,
    `- **Project ID**: ${flamegraph.projectID}`,
    `- **Platform**: ${flamegraph.platform || "Unknown"}`,
    `- **Total Profiles**: ${flamegraph.shared.profiles.length}`,
    `- **Total Samples**: ${totalSamples.toLocaleString()}`,
    `- **Estimated Total Time**: ${formatDuration(totalDuration)}`,
  ].join("\n");
}

/**
 * Formats performance summary section.
 */
function formatPerformanceSummary(
  flamegraph: Flamegraph,
  options: FlamegraphAnalysisOptions,
): string {
  const hotspots = identifyHotspotFramesFromFlamegraph(flamegraph, {
    focusOnUserCode: false, // Get both user and library for breakdown
  });

  const userCodeTime = hotspots
    .filter((h) => h.frame.is_application)
    .reduce((sum, h) => sum + h.frameInfo.weight, 0);

  const libraryTime = hotspots
    .filter((h) => !h.frame.is_application)
    .reduce((sum, h) => sum + h.frameInfo.weight, 0);

  const totalTime = userCodeTime + libraryTime;
  const userPercent = totalTime > 0 ? (userCodeTime / totalTime) * 100 : 0;
  const libraryPercent = totalTime > 0 ? (libraryTime / totalTime) * 100 : 0;

  const sections = [
    "## Performance Summary",
    "",
    "### Code Breakdown",
    `- **Total User Code Time**: ${formatDuration(userCodeTime)} (${formatPercentage(userPercent)})`,
    `- **Total Library Time**: ${formatDuration(libraryTime)} (${formatPercentage(libraryPercent)})`,
  ];

  // Top slow functions table
  const topFunctions = identifyHotspotFramesFromFlamegraph(
    flamegraph,
    options,
  ).slice(0, 10);

  if (topFunctions.length > 0) {
    sections.push("", "### Top Slow Functions");
    sections.push("");
    sections.push(
      "| Function | File:Line | Samples | % Time | p75 | p95 | p99 | Insights |",
    );
    sections.push(
      "|----------|-----------|---------|--------|-----|-----|-----|----------|",
    );

    for (const func of topFunctions) {
      const insights = generatePerformanceInsights(func.frameInfo);
      const insightText = insights.map((i) => i.icon).join(" ");
      const location = `${func.frame.file}:${func.frame.line}`;
      const truncatedLocation =
        location.length > 30 ? `...${location.slice(-27)}` : location;

      sections.push(
        `| \`${func.frame.name}\` | ${truncatedLocation} | ${func.frameInfo.count.toLocaleString()} | ${formatPercentage(func.percentOfTotal)} | ${formatDuration(func.frameInfo.p75Duration)} | ${formatDuration(func.frameInfo.p95Duration)} | ${formatDuration(func.frameInfo.p99Duration)} | ${insightText} |`,
      );
    }
  }

  return sections.join("\n");
}

/**
 * Formats hot paths section.
 */
function formatHotPaths(
  hotPaths: HotPath[],
  flamegraph: Flamegraph,
  options: FlamegraphAnalysisOptions,
): string {
  if (hotPaths.length === 0) {
    return "## Hot Paths\n\nNo significant hot paths found.";
  }

  const sections = ["## Top Hot Paths", ""];

  hotPaths.forEach((path, idx) => {
    if (idx > 0) sections.push("---", "");

    sections.push(
      `### Path #${idx + 1}: ${formatPercentage(path.percentOfTotal)} of execution time`,
    );
    sections.push("");
    sections.push(
      `**${path.sampleCount.toLocaleString()} samples** across ${flamegraph.shared.profiles.length} profiles`,
    );
    sections.push("");

    // Display call stack
    const framesToShow = options.focusOnUserCode
      ? path.userCodeFrames
      : path.callStack;

    if (framesToShow.length > 0) {
      sections.push("```");
      framesToShow.forEach((frame, i) => {
        const indent = "  ".repeat(frame.depth);
        const marker = frame.frame.is_application ? "[YOUR CODE]" : "[library]";
        const isPrimary = i === 0 && options.focusOnUserCode;
        const suffix = isPrimary ? " ← PRIMARY BOTTLENECK" : "";
        sections.push(
          `${indent}${frame.frame.file}:${frame.frame.name}:${frame.frame.line} ${marker}${suffix}`,
        );
      });
      sections.push("```");
      sections.push("");
    }

    // Performance characteristics
    const leafFrame = path.callStack[path.callStack.length - 1];
    if (leafFrame) {
      const insights = generatePerformanceInsights(leafFrame.frameInfo);
      sections.push("**Performance Characteristics:**");
      sections.push(
        `- **p75**: ${formatDuration(leafFrame.frameInfo.p75Duration)}`,
      );
      sections.push(
        `- **p95**: ${formatDuration(leafFrame.frameInfo.p95Duration)}`,
      );
      sections.push(
        `- **p99**: ${formatDuration(leafFrame.frameInfo.p99Duration)}${insights.some((i) => i.type === "high_variance") ? " (⚠️ High variance - some calls are very slow)" : ""}`,
      );
      sections.push("");

      // Recommendations
      sections.push("**💡 Recommendation:**");
      sections.push(
        `This path accounts for ${formatPercentage(path.percentOfTotal)} of CPU time.${insights.some((i) => i.type === "high_variance") ? " The high p99 indicates some operations are very slow." : ""}`,
      );
      sections.push("");
    }
  });

  return sections.join("\n");
}

/**
 * Formats actionable next steps section.
 */
function formatActionableSteps(
  hotPaths: HotPath[],
  flamegraph: Flamegraph,
): string {
  const sections = [
    "## Actionable Next Steps",
    "",
    "### Immediate Actions (High Impact)",
  ];

  // Suggest optimization for top path
  if (hotPaths.length > 0) {
    const topPath = hotPaths[0];
    const leafFrame = topPath.callStack[topPath.callStack.length - 1];
    if (leafFrame) {
      sections.push(
        `1. **Optimize \`${leafFrame.frame.name}\` function** - Accounts for ${formatPercentage(topPath.percentOfTotal)} of CPU time`,
      );
    }
  }

  // Generic recommendations
  sections.push(
    "2. **Add caching layer** - Consider caching frequently accessed data",
  );
  sections.push(
    "3. **Review query patterns** - Look for N+1 queries or inefficient data access",
  );

  sections.push("");
  sections.push("### Investigation Actions");

  // Link to profiles for deep dive
  if (flamegraph.shared.profiles.length > 0) {
    const profileId = flamegraph.shared.profiles[0]?.profile_id;
    if (profileId) {
      sections.push(
        `1. **Get detailed profile**: Use profiler_id \`${profileId}\` for sample-level analysis`,
      );
    }
  }

  sections.push(
    "2. **Compare with baseline**: Use compare_transaction_profiles to check for regressions",
  );

  return sections.join("\n");
}

/**
 * Formats flamegraph comparison for regression detection.
 *
 * Produces markdown output with:
 * - Comparison summary
 * - Key changes table
 * - Regressions detected
 * - Suggested investigation steps
 *
 * @param baseline Baseline flamegraph data
 * @param current Current flamegraph data
 * @param options Formatting options
 * @returns Markdown-formatted comparison
 */
export function formatFlamegraphComparison(
  baseline: Flamegraph,
  current: Flamegraph,
  options: FlamegraphComparisonOptions,
): string {
  const sections: string[] = [];

  // Comparison summary
  sections.push(
    `# Profile Comparison: ${current.transactionName || "Unknown Transaction"}`,
  );
  sections.push("");
  sections.push("## Summary");

  const comparisons = compareFrameStats(baseline, current, options);
  const majorRegressions = comparisons.filter(
    (c) => c.changeType === "major_regression",
  );
  const minorRegressions = comparisons.filter(
    (c) => c.changeType === "minor_regression",
  );
  const improvements = comparisons.filter(
    (c) => c.changeType === "improvement",
  );

  let status: string;
  if (majorRegressions.length > 0) {
    status = "⚠️ Performance Regression Detected";
  } else if (minorRegressions.length > 0) {
    status = "⚠️ Minor Performance Changes Detected";
  } else if (improvements.length > 0) {
    status = "✅ Performance Improvements Detected";
  } else {
    status = "✅ No Significant Changes";
  }

  sections.push(`- **Status**: ${status}`);
  sections.push("");

  // Key changes
  if (comparisons.length > 0) {
    sections.push("## Key Changes");
    sections.push("");
    sections.push(
      "| Function | File:Line | Baseline | Current | Change | Status |",
    );
    sections.push(
      "|----------|-----------|----------|---------|--------|--------|",
    );

    // Show top 10 changes
    for (const comp of comparisons.slice(0, 10)) {
      const location = `${comp.frame.file}:${comp.frame.line}`;
      const truncatedLocation =
        location.length > 30 ? `...${location.slice(-27)}` : location;
      const statusIcon = CHANGE_TYPE_ICONS[comp.changeType];
      const change =
        comp.percentChange > 0
          ? `+${formatPercentage(comp.percentChange)}`
          : formatPercentage(comp.percentChange);

      sections.push(
        `| \`${comp.frame.name}\` | ${truncatedLocation} | ${formatDuration(comp.baseline.weight)} | ${formatDuration(comp.current.weight)} | ${change} | ${statusIcon} |`,
      );
    }
    sections.push("");
  }

  // Regressions detected
  if (majorRegressions.length > 0) {
    sections.push("## Major Regressions Detected");
    sections.push("");

    for (const reg of majorRegressions.slice(0, 5)) {
      sections.push(`### 🚨 \`${reg.frame.name}\``);
      sections.push(
        `- **Change**: +${formatPercentage(reg.percentChange)} slower`,
      );
      sections.push(
        `- **Impact**: ${formatDuration(reg.baseline.weight)} → ${formatDuration(reg.current.weight)}`,
      );
      sections.push(`- **Location**: ${reg.frame.file}:${reg.frame.line}`);
      sections.push("");
      sections.push(
        "**Suggested Action**: Investigate recent changes to this function",
      );
      sections.push("");
    }
  }

  return sections.join("\n");
}

/**
 * Formats raw profile chunk analysis.
 *
 * Produces markdown output with:
 * - Chunk metadata
 * - Sample summary
 * - Frame breakdown
 * - Thread information
 *
 * @param chunk Profile chunk data from API
 * @param options Formatting options
 * @returns Markdown-formatted analysis
 */
export function formatProfileChunkAnalysis(
  chunk: ProfileChunk,
  options: ProfileChunkAnalysisOptions,
): string {
  const sections: string[] = [];

  sections.push("# Profile Chunk Details");
  sections.push("");
  sections.push("## Metadata");
  sections.push(`- **Chunk ID**: ${chunk.chunk_id}`);
  sections.push(`- **Profiler ID**: ${chunk.profiler_id}`);
  sections.push(`- **Platform**: ${chunk.platform}`);
  sections.push(`- **Release**: ${chunk.release}`);
  if (chunk.environment) {
    sections.push(`- **Environment**: ${chunk.environment}`);
  }
  sections.push("");

  sections.push("## Sample Summary");
  sections.push(`- **Total Frames**: ${chunk.profile.frames.length}`);
  sections.push(`- **Total Samples**: ${chunk.profile.samples.length}`);
  sections.push(`- **Total Stacks**: ${chunk.profile.stacks.length}`);
  sections.push(
    `- **Threads**: ${Object.keys(chunk.profile.thread_metadata).length}`,
  );
  sections.push("");

  // Thread information
  sections.push("## Thread Information");
  sections.push("");
  for (const [threadId, metadata] of Object.entries(
    chunk.profile.thread_metadata,
  )) {
    const threadSamples = chunk.profile.samples.filter(
      (s) => s.thread_id === threadId,
    );
    sections.push(
      `- **Thread ${threadId}**: ${metadata.name || "unnamed"} (${threadSamples.length} samples)`,
    );
  }
  sections.push("");

  // Frame breakdown (top 10 most frequent)
  const frameCounts = new Map<number, number>();
  for (const stack of chunk.profile.stacks) {
    for (const frameIdx of stack) {
      frameCounts.set(frameIdx, (frameCounts.get(frameIdx) || 0) + 1);
    }
  }

  const sortedFrames = Array.from(frameCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sortedFrames.length > 0) {
    sections.push("## Top Frames by Occurrence");
    sections.push("");
    sections.push("| Function | File:Line | Count | Type |");
    sections.push("|----------|-----------|-------|------|");

    for (const [frameIdx, count] of sortedFrames) {
      const frame = chunk.profile.frames[frameIdx];
      if (!frame) continue;

      if (options.focusOnUserCode && !frame.in_app) continue;

      const location =
        frame.filename && frame.lineno
          ? `${frame.filename}:${frame.lineno}`
          : frame.abs_path || "unknown";
      const truncatedLocation =
        location.length > 40 ? `...${location.slice(-37)}` : location;
      const type = frame.in_app ? "User Code" : "Library";

      sections.push(
        `| \`${frame.function}\` | ${truncatedLocation} | ${count} | ${type} |`,
      );
    }
  }

  return sections.join("\n");
}
