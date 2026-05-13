import type { z } from "zod";
import type {
  AutofixExplorerArtifact,
  AutofixExplorerBlock,
  AutofixExplorerFilePatch,
  AutofixExplorerRepoPRState,
  AutofixExplorerStatusSchema,
  AutofixRunState,
} from "../../api-client/index";

export const SEER_POLLING_INTERVAL = 5000; // 5 seconds
export const SEER_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const SEER_MAX_RETRIES = 3; // Maximum retries for transient failures
export const SEER_INITIAL_RETRY_DELAY = 1000; // 1 second initial retry delay

type AutofixExplorerStatus = z.infer<typeof AutofixExplorerStatusSchema>;

export function getStatusDisplayName(status: string): string {
  switch (status) {
    case "completed":
      return "Complete";
    case "error":
      return "Failed";
    case "awaiting_user_input":
      return "Waiting for Response";
    case "processing":
      return "Processing";
    default:
      return status;
  }
}

/**
 * The explorer endpoint reports a single top-level status per run.
 * `processing` is the only non-terminal value the upstream type spells out
 * today (see `useExplorerAutofix.tsx`).
 */
export function isTerminalStatus(status: string): boolean {
  return status !== "processing";
}

/**
 * `awaiting_user_input` means Seer paused for the user; surface it
 * separately so callers can prompt the user rather than fail.
 */
export function isHumanInterventionStatus(status: string): boolean {
  return status === "awaiting_user_input";
}

export function getHumanInterventionGuidance(status: string): string {
  if (status === "awaiting_user_input") {
    return "\nSeer is waiting for your response to proceed. Please review the analysis and provide feedback.\n";
  }
  return "";
}

function escapeXmlAttribute(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapSeerAnalysisOutput({
  output,
  runId,
  step,
  includeProvenanceTags,
}: {
  output: string;
  runId?: number;
  step: string;
  includeProvenanceTags: boolean;
}): string {
  if (!includeProvenanceTags) {
    return `${output.trimEnd()}\n`;
  }

  const attrs = [
    runId === undefined ? null : `run_id="${escapeXmlAttribute(runId)}"`,
    `step="${escapeXmlAttribute(step)}"`,
  ].filter(Boolean);

  return `<seer_analysis ${attrs.join(" ")}>\n${output.trimEnd()}\n</seer_analysis>\n`;
}

/**
 * Section produced by grouping explorer blocks by their `metadata.step` marker
 * — the unit the analyze tool and the issue-details summary render.
 */
export interface AutofixSection {
  step: string;
  status: "processing" | "completed";
  blocks: AutofixExplorerBlock[];
  artifacts: AutofixExplorerArtifact[];
  mergedFilePatches: AutofixExplorerFilePatch[];
}

/**
 * Walk explorer blocks in order, opening a new section every time we see a
 * block with `message.metadata.step`. Mirrors `getOrderedAutofixSections` in
 * `static/app/components/events/autofix/useExplorerAutofix.tsx` so MCP output
 * stays aligned with the Sentry UI's notion of sections.
 */
export function getOrderedAutofixSections(
  autofix: AutofixRunState["autofix"],
): AutofixSection[] {
  const blocks = autofix?.blocks ?? [];
  const sections: AutofixSection[] = [];
  const mergedByFile = new Map<string, AutofixExplorerFilePatch>();

  let current: AutofixSection = {
    step: "unknown",
    status: "processing",
    blocks: [],
    artifacts: [],
    mergedFilePatches: [],
  };

  const finalize = (forceComplete: boolean) => {
    if (current.blocks.length === 0) {
      return;
    }
    if (forceComplete || current.artifacts.length > 0) {
      current.status = "completed";
    }
    if (current.status === "completed" && current.step === "code_changes") {
      current.mergedFilePatches = Array.from(mergedByFile.values());
    }
    sections.push(current);
  };

  for (const block of blocks) {
    if (block.merged_file_patches?.length) {
      for (const patch of block.merged_file_patches) {
        const key = `${patch.repo_name}:${patch.patch.path}`;
        mergedByFile.set(key, patch);
      }
    }

    const step = block.message?.metadata?.step;
    if (step && step !== current.step) {
      finalize(true);
      current = {
        step,
        status: "processing",
        blocks: [],
        artifacts: [],
        mergedFilePatches: [],
      };
    }

    current.blocks.push(block);
    if (block.artifacts?.length) {
      current.artifacts.push(...block.artifacts);
    }
  }

  finalize(autofix?.status !== "processing");

  const pullRequests = Object.values(autofix?.repo_pr_states ?? {});
  if (pullRequests.length > 0) {
    const allDone = !pullRequests.some(
      (state) => state.pr_creation_status === "creating",
    );
    sections.push({
      step: "pull_request",
      status: allDone ? "completed" : "processing",
      blocks: [],
      artifacts: [],
      mergedFilePatches: [],
    });
  }

  return sections;
}

function getSectionTitle(step: string): string {
  switch (step) {
    case "root_cause":
      return "Root Cause";
    case "solution":
      return "Solution";
    case "code_changes":
      return "Code Changes";
    case "pull_request":
      return "Pull Requests";
    default:
      return step.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

interface RootCauseArtifactData {
  one_line_description?: unknown;
  five_whys?: unknown;
  reproduction_steps?: unknown;
}

interface SolutionArtifactData {
  one_line_summary?: unknown;
  steps?: unknown;
}

function renderRootCauseArtifact(data: RootCauseArtifactData): string {
  let body = "";
  if (typeof data.one_line_description === "string") {
    body += `${data.one_line_description.trim()}\n\n`;
  }
  if (Array.isArray(data.five_whys) && data.five_whys.length > 0) {
    body += `**Five Whys**\n`;
    for (const why of data.five_whys) {
      if (typeof why === "string" && why.trim()) {
        body += `- ${why.trim()}\n`;
      }
    }
    body += "\n";
  }
  if (
    Array.isArray(data.reproduction_steps) &&
    data.reproduction_steps.length > 0
  ) {
    body += `**Reproduction Steps**\n`;
    for (const stepText of data.reproduction_steps) {
      if (typeof stepText === "string" && stepText.trim()) {
        body += `- ${stepText.trim()}\n`;
      }
    }
    body += "\n";
  }
  return body;
}

function renderSolutionArtifact(data: SolutionArtifactData): string {
  let body = "";
  if (typeof data.one_line_summary === "string") {
    body += `${data.one_line_summary.trim()}\n\n`;
  }
  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (step === null || typeof step !== "object") continue;
      const obj = step as Record<string, unknown>;
      if (typeof obj.title === "string" && obj.title.trim()) {
        body += `**${obj.title.trim()}**\n`;
      }
      if (typeof obj.description === "string" && obj.description.trim()) {
        body += `${obj.description.trim()}\n\n`;
      }
    }
  }
  return body;
}

function renderFilePatchesArtifact(
  patches: AutofixExplorerFilePatch[],
): string {
  if (patches.length === 0) return "";
  let body = "";
  for (const patch of patches) {
    const path = patch.patch.path;
    const added = patch.patch.added ?? 0;
    const removed = patch.patch.removed ?? 0;
    body += `- \`${patch.repo_name}:${path}\` (+${added}/-${removed})\n`;
  }
  return body;
}

function renderPullRequestsArtifact(
  pullRequests: AutofixExplorerRepoPRState[],
): string {
  if (pullRequests.length === 0) return "";
  let body = "";
  for (const pr of pullRequests) {
    const title = pr.title ?? `${pr.repo_name} PR`;
    if (pr.pr_url) {
      const number = pr.pr_number ? ` (#${pr.pr_number})` : "";
      body += `- [${title}${number}](${pr.pr_url}) — ${pr.repo_name}\n`;
    } else if (pr.pr_creation_status === "error" && pr.pr_creation_error) {
      body += `- ${title} — ${pr.repo_name}: failed (${pr.pr_creation_error})\n`;
    } else {
      body += `- ${title} — ${pr.repo_name}: ${pr.pr_creation_status ?? "pending"}\n`;
    }
  }
  return body;
}

/**
 * Renders one section as markdown. Picks the right artifact renderer based on
 * the section's step (`root_cause` / `solution` / `code_changes` /
 * `pull_request`) and falls back to the rolled-up assistant message content
 * for any unknown step keys so we don't drop information.
 */
export function getOutputForAutofixSection(
  section: AutofixSection,
  options: {
    runId?: number;
    includeProvenanceTags?: boolean;
    pullRequests?: AutofixExplorerRepoPRState[];
  } = {},
): string {
  const includeProvenanceTags = options.includeProvenanceTags ?? true;
  const heading = `## ${getSectionTitle(section.step)}\n\n`;

  if (section.status === "processing") {
    return `${heading}**Sentry is still working on this step. Please check back in a minute.**\n\n`;
  }

  let body = "";

  if (section.step === "root_cause") {
    const artifact = section.artifacts.find((a) => a.key === "root_cause");
    if (artifact?.data && typeof artifact.data === "object") {
      body += renderRootCauseArtifact(artifact.data as RootCauseArtifactData);
    }
  } else if (section.step === "solution") {
    const artifact = section.artifacts.find((a) => a.key === "solution");
    if (artifact?.data && typeof artifact.data === "object") {
      body += renderSolutionArtifact(artifact.data as SolutionArtifactData);
    }
  } else if (section.step === "code_changes") {
    body += renderFilePatchesArtifact(section.mergedFilePatches);
  } else if (section.step === "pull_request") {
    body += renderPullRequestsArtifact(options.pullRequests ?? []);
  }

  // Fallback: if no structured artifact data was produced, surface the last
  // non-empty assistant message in the section so the user still gets context.
  if (!body.trim() && section.blocks.length > 0) {
    for (let i = section.blocks.length - 1; i >= 0; i--) {
      const content = section.blocks[i]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        body += `${content.trim()}\n`;
        break;
      }
    }
  }

  if (!body.trim()) {
    return heading;
  }

  return wrapSeerAnalysisOutput({
    output: body,
    runId: options.runId,
    step: section.step,
    includeProvenanceTags,
  });
}

/**
 * Convenience renderer that emits every section in order, applying the same
 * provenance-tag treatment as the legacy step renderer.
 */
export function getOutputForAutofix(
  autofix: AutofixRunState["autofix"],
  options: { includeProvenanceTags?: boolean } = {},
): string {
  if (!autofix) return "";
  const sections = getOrderedAutofixSections(autofix);
  const pullRequests = Object.values(autofix.repo_pr_states ?? {});
  let body = "";
  for (const section of sections) {
    body += getOutputForAutofixSection(section, {
      runId: autofix.run_id,
      includeProvenanceTags: options.includeProvenanceTags,
      pullRequests,
    });
    body += "\n";
  }
  return body;
}

export function findCompletedSection(
  sections: AutofixSection[],
  step: string,
): AutofixSection | undefined {
  return sections.find((s) => s.step === step && s.status === "completed");
}

export function hasSection(sections: AutofixSection[], step: string): boolean {
  return sections.some((s) => s.step === step);
}

export type { AutofixExplorerStatus };
