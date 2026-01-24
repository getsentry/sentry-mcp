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
 * Determines the overall comparison status based on regression/improvement counts.
 */
function determineComparisonStatus(
  majorCount: number,
  minorCount: number,
  improvementCount: number,
): string {
  if (majorCount > 0) return "⚠️ Performance Regression Detected";
  if (minorCount > 0) return "⚠️ Minor Performance Changes Detected";
  if (improvementCount > 0) return "✅ Performance Improvements Detected";
  return "✅ No Significant Changes";
}

/**
 * Truncates a file location string for table display.
 */
function truncateLocation(location: string, maxLength = 30): string {
  if (location.length <= maxLength) return location;
  return `...${location.slice(-(maxLength - 3))}`;
}

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
  sections.push(formatActionableSteps(hotPaths, options));

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

  // Calculate time breakdown in a single pass
  let userCodeTime = 0;
  let libraryTime = 0;
  for (const h of hotspots) {
    if (h.frame.is_application) {
      userCodeTime += h.frameInfo.sumDuration;
    } else {
      libraryTime += h.frameInfo.sumDuration;
    }
  }

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
      const location = truncateLocation(
        `${func.frame.file}:${func.frame.line}`,
      );

      sections.push(
        `| \`${func.frame.name}\` | ${location} | ${func.frameInfo.count.toLocaleString()} | ${formatPercentage(func.percentOfTotal)} | ${formatDuration(func.frameInfo.p75Duration)} | ${formatDuration(func.frameInfo.p95Duration)} | ${formatDuration(func.frameInfo.p99Duration)} | ${insightText} |`,
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

    // Display call stack - filter to user code during formatting if requested
    // Call stack is stored leaf-to-root, so we reverse for display (root-to-leaf)
    const framesToShow = options.focusOnUserCode
      ? path.userCodeFrames
      : path.callStack;

    if (framesToShow.length > 0) {
      sections.push("```");
      // Display root-to-leaf (reverse the stored order for readability)
      const displayFrames = [...framesToShow].reverse();
      displayFrames.forEach((frame, i) => {
        const indent = "  ".repeat(i);
        const marker = frame.frame.is_application ? "[YOUR CODE]" : "[library]";
        // The last displayed frame (original leaf) is the primary bottleneck
        const isLeaf = i === displayFrames.length - 1;
        const suffix =
          isLeaf && options.focusOnUserCode ? " ← PRIMARY BOTTLENECK" : "";
        sections.push(
          `${indent}${frame.frame.file}:${frame.frame.name}:${frame.frame.line} ${marker}${suffix}`,
        );
      });
      sections.push("```");
      sections.push("");
    }

    // Performance characteristics - leaf frame is at index 0 (leaf-to-root order)
    const leafFrame = path.callStack[0];
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
  options: FlamegraphAnalysisOptions,
): string {
  const sections = [
    "## Actionable Next Steps",
    "",
    "### Immediate Actions (High Impact)",
  ];

  // Suggest optimization for top path
  const topPath = hotPaths[0];
  if (topPath) {
    // When focusOnUserCode is true, recommend the deepest user code frame (closest to bottleneck)
    // callStack is in leaf-to-root order, so userCodeFrames[0] is the deepest user code frame
    const frameToRecommend = options.focusOnUserCode
      ? topPath.userCodeFrames[0]
      : topPath.callStack[0];
    if (frameToRecommend) {
      sections.push(
        `1. **Optimize \`${frameToRecommend.frame.name}\` function** - Accounts for ${formatPercentage(topPath.percentOfTotal)} of CPU time`,
      );
    }
  }

  sections.push(
    "2. **Add caching layer** - Consider caching frequently accessed data",
    "3. **Review query patterns** - Look for N+1 queries or inefficient data access",
    "",
    "### Investigation Actions",
    "1. **Compare with baseline**: Use get_profile with compareAgainstPeriod to check for regressions",
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

  const status = determineComparisonStatus(
    majorRegressions.length,
    minorRegressions.length,
    improvements.length,
  );

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
      const location = truncateLocation(
        `${comp.frame.file}:${comp.frame.line}`,
      );
      const statusIcon = CHANGE_TYPE_ICONS[comp.changeType];
      const change =
        comp.percentChange > 0
          ? `+${formatPercentage(comp.percentChange)}`
          : formatPercentage(comp.percentChange);

      sections.push(
        `| \`${comp.frame.name}\` | ${location} | ${formatDuration(comp.baseline.sumDuration)} | ${formatDuration(comp.current.sumDuration)} | ${change} | ${statusIcon} |`,
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
        `- **Impact**: ${formatDuration(reg.baseline.sumDuration)} → ${formatDuration(reg.current.sumDuration)}`,
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

      const rawLocation =
        frame.filename && frame.lineno
          ? `${frame.filename}:${frame.lineno}`
          : frame.abs_path || "unknown";
      const location = truncateLocation(rawLocation, 40);
      const type = frame.in_app ? "User Code" : "Library";

      sections.push(
        `| \`${frame.function}\` | ${location} | ${count} | ${type} |`,
      );
    }
  }

  return sections.join("\n");
}
