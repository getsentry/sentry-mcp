/**
 * Human-readable output formatters
 *
 * Centralized formatting utilities for consistent CLI output.
 * Follows gh cli patterns for alignment and presentation.
 */

import type {
  IssueStatus,
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../../types/index.js";
import { green, levelColor, muted, statusColor, yellow } from "./colors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status Formatting
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<IssueStatus, string> = {
  resolved: green("✓"),
  unresolved: yellow("●"),
  ignored: muted("−"),
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  resolved: `${green("✓")} Resolved`,
  unresolved: `${yellow("●")} Unresolved`,
  ignored: `${muted("−")} Ignored`,
};

/** Maximum features to display before truncating with "... and N more" */
const MAX_DISPLAY_FEATURES = 10;

/**
 * Format a features array for display, truncating if necessary.
 *
 * @param features - Array of feature names (may be undefined)
 * @returns Formatted lines to append to output, or empty array if no features
 */
function formatFeaturesList(features: string[] | undefined): string[] {
  if (!features || features.length === 0) {
    return [];
  }

  const lines: string[] = ["", `Features (${features.length}):`];
  const displayFeatures = features.slice(0, MAX_DISPLAY_FEATURES);
  lines.push(`  ${displayFeatures.join(", ")}`);

  if (features.length > MAX_DISPLAY_FEATURES) {
    lines.push(`  ... and ${features.length - MAX_DISPLAY_FEATURES} more`);
  }

  return lines;
}

/** Minimum width for header separator line */
const MIN_HEADER_WIDTH = 20;

/**
 * Format a details header with slug and name.
 * Handles empty values gracefully.
 *
 * @param slug - Resource slug (e.g., org or project slug)
 * @param name - Resource display name
 * @returns Array with header line and separator
 */
function formatDetailsHeader(slug: string, name: string): [string, string] {
  const displaySlug = slug || "(no slug)";
  const displayName = name || "(unnamed)";
  const header = `${displaySlug}: ${displayName}`;
  const separatorWidth = Math.max(
    MIN_HEADER_WIDTH,
    Math.min(80, header.length)
  );
  return [header, muted("═".repeat(separatorWidth))];
}

/**
 * Get status icon for an issue status
 */
export function formatStatusIcon(status: string | undefined): string {
  if (!status) {
    return statusColor("●", status);
  }
  return STATUS_ICONS[status as IssueStatus] ?? statusColor("●", status);
}

/**
 * Get full status label for an issue status
 */
export function formatStatusLabel(status: string | undefined): string {
  if (!status) {
    return `${statusColor("●", status)} Unknown`;
  }
  return STATUS_LABELS[status as IssueStatus] ?? `${statusColor("●", status)} Unknown`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table Formatting
// ─────────────────────────────────────────────────────────────────────────────

type TableColumn = {
  header: string;
  width: number;
  align?: "left" | "right";
};

/**
 * Format a table with aligned columns
 */
export function formatTable(
  columns: TableColumn[],
  rows: string[][]
): string[] {
  const lines: string[] = [];

  // Header
  const header = columns
    .map((col) =>
      col.align === "right"
        ? col.header.padStart(col.width)
        : col.header.padEnd(col.width)
    )
    .join("  ");
  lines.push(header);

  // Rows
  for (const row of rows) {
    const formatted = row
      .map((cell, i) => {
        const col = columns[i];
        if (!col) {
          return cell;
        }
        return col.align === "right"
          ? cell.padStart(col.width)
          : cell.padEnd(col.width);
      })
      .join("  ");
    lines.push(formatted);
  }

  return lines;
}

/**
 * Create a horizontal divider
 */
export function divider(length = 80, char = "─"): string {
  return muted(char.repeat(length));
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a single issue for list display (one line)
 */
export function formatIssueRow(issue: SentryIssue): string {
  const status = formatStatusIcon(issue.status);
  const levelText = (issue.level ?? "unknown").toUpperCase().padEnd(7);
  const level = levelColor(levelText, issue.level);
  const count = `${issue.count}`.padStart(5);
  const shortId = issue.shortId.padEnd(15);

  return `${status} ${level} ${shortId} ${count}  ${issue.title}`;
}

/**
 * Format detailed issue information
 */
export function formatIssueDetails(issue: SentryIssue): string[] {
  const lines: string[] = [];

  // Header
  lines.push(`${issue.shortId}: ${issue.title}`);
  lines.push(
    muted("═".repeat(Math.min(80, issue.title.length + issue.shortId.length + 2)))
  );
  lines.push("");

  // Status and level
  lines.push(`Status:     ${formatStatusLabel(issue.status)}`);
  lines.push(`Level:      ${issue.level ?? "unknown"}`);
  lines.push(`Platform:   ${issue.platform}`);
  lines.push(`Type:       ${issue.type}`);
  lines.push("");

  // Project
  if (issue.project) {
    lines.push(`Project:    ${issue.project.name} (${issue.project.slug})`);
    lines.push("");
  }

  // Stats
  lines.push(`Events:     ${issue.count}`);
  lines.push(`Users:      ${issue.userCount}`);
  if (issue.firstSeen) {
    lines.push(`First seen: ${new Date(issue.firstSeen).toLocaleString()}`);
  }
  if (issue.lastSeen) {
    lines.push(`Last seen:  ${new Date(issue.lastSeen).toLocaleString()}`);
  }
  lines.push("");

  // Culprit
  if (issue.culprit) {
    lines.push(`Culprit:    ${issue.culprit}`);
    lines.push("");
  }

  // Metadata
  if (issue.metadata?.value) {
    lines.push("Message:");
    lines.push(`  ${issue.metadata.value}`);
    lines.push("");
  }

  if (issue.metadata?.filename) {
    lines.push(`File:       ${issue.metadata.filename}`);
  }
  if (issue.metadata?.function) {
    lines.push(`Function:   ${issue.metadata.function}`);
  }

  // Assignee
  if (issue.assignedTo) {
    lines.push("");
    lines.push(`Assigned:   ${issue.assignedTo.name}`);
  }

  // Link
  lines.push("");
  lines.push(`Link:       ${issue.permalink}`);

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format event details for display.
 *
 * @param event - The Sentry event to format
 * @param header - Optional header text (defaults to "Latest Event")
 * @returns Array of formatted lines
 */
export function formatEventDetails(
  event: SentryEvent,
  header = "Latest Event"
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(muted(`─── ${header} ───`));
  lines.push("");
  lines.push(`Event ID:   ${event.eventID}`);
  if (event.dateReceived) {
    lines.push(`Received:   ${new Date(event.dateReceived).toLocaleString()}`);
  }

  if (event.user) {
    lines.push("");
    lines.push("User:");
    if (event.user.email) {
      lines.push(`  Email:    ${event.user.email}`);
    }
    if (event.user.username) {
      lines.push(`  Username: ${event.user.username}`);
    }
    if (event.user.id) {
      lines.push(`  ID:       ${event.user.id}`);
    }
    if (event.user.ip_address) {
      lines.push(`  IP:       ${event.user.ip_address}`);
    }
  }

  if (event.sdk) {
    lines.push("");
    lines.push(`SDK:        ${event.sdk.name} ${event.sdk.version}`);
  }

  if (event.tags?.length) {
    lines.push("");
    lines.push("Tags:");
    const maxTags = 10;
    for (const tag of event.tags.slice(0, maxTags)) {
      lines.push(`  ${tag.key}: ${tag.value}`);
    }
    if (event.tags.length > maxTags) {
      lines.push(`  ... and ${event.tags.length - maxTags} more`);
    }
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format organization for list display
 */
export function formatOrgRow(
  org: SentryOrganization,
  slugWidth: number
): string {
  return `${org.slug.padEnd(slugWidth)}  ${org.name}`;
}

/**
 * Calculate max slug width from organizations
 */
export function calculateOrgSlugWidth(orgs: SentryOrganization[]): number {
  return Math.max(...orgs.map((o) => o.slug.length), 4);
}

/**
 * Format detailed organization information.
 *
 * @param org - The Sentry organization to format
 * @returns Array of formatted lines
 */
export function formatOrgDetails(org: SentryOrganization): string[] {
  const lines: string[] = [];

  // Header
  const [header, separator] = formatDetailsHeader(org.slug, org.name);
  lines.push(header, separator, "");

  // Basic info
  lines.push(`Slug:       ${org.slug || "(none)"}`);
  lines.push(`Name:       ${org.name || "(unnamed)"}`);
  lines.push(`ID:         ${org.id}`);
  if (org.dateCreated) {
    lines.push(`Created:    ${new Date(org.dateCreated).toLocaleString()}`);
  }
  lines.push("");

  // Settings
  lines.push(`2FA:        ${org.require2FA ? "Required" : "Not required"}`);
  lines.push(`Early Adopter: ${org.isEarlyAdopter ? "Yes" : "No"}`);

  // Features
  lines.push(...formatFeaturesList(org.features));

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Formatting
// ─────────────────────────────────────────────────────────────────────────────

type ProjectRowOptions = {
  showOrg: boolean;
  orgSlug?: string;
  slugWidth: number;
};

/**
 * Format project for list display
 */
export function formatProjectRow(
  project: SentryProject,
  options: ProjectRowOptions
): string {
  const { showOrg, orgSlug, slugWidth } = options;
  const slug = showOrg
    ? `${orgSlug}/${project.slug}`.padEnd(slugWidth)
    : project.slug.padEnd(slugWidth);
  const platform = (project.platform || "").padEnd(20);
  return `${slug}  ${platform}  ${project.name}`;
}

/**
 * Calculate max slug width from projects
 */
export function calculateProjectSlugWidth(
  projects: Array<SentryProject & { orgSlug?: string }>,
  showOrg: boolean
): number {
  return Math.max(
    ...projects.map((p) =>
      showOrg ? `${p.orgSlug}/${p.slug}`.length : p.slug.length
    ),
    4
  );
}

/**
 * Format detailed project information.
 *
 * @param project - The Sentry project to format
 * @returns Array of formatted lines
 */
export function formatProjectDetails(project: SentryProject): string[] {
  const lines: string[] = [];

  // Header
  const [header, separator] = formatDetailsHeader(project.slug, project.name);
  lines.push(header, separator, "");

  // Basic info
  lines.push(`Slug:       ${project.slug || "(none)"}`);
  lines.push(`Name:       ${project.name || "(unnamed)"}`);
  lines.push(`ID:         ${project.id}`);
  lines.push(`Platform:   ${project.platform || "Not set"}`);
  lines.push(`Status:     ${project.status}`);
  if (project.dateCreated) {
    lines.push(`Created:    ${new Date(project.dateCreated).toLocaleString()}`);
  }

  // Organization context
  if (project.organization) {
    lines.push("");
    lines.push(
      `Organization: ${project.organization.name} (${project.organization.slug})`
    );
  }

  // Activity info
  lines.push("");
  if (project.firstEvent) {
    lines.push(`First Event: ${new Date(project.firstEvent).toLocaleString()}`);
  } else {
    lines.push("First Event: No events yet");
  }

  // Capabilities
  lines.push("");
  lines.push("Capabilities:");
  lines.push(`  Sessions:  ${project.hasSessions ? "Yes" : "No"}`);
  lines.push(`  Replays:   ${project.hasReplays ? "Yes" : "No"}`);
  lines.push(`  Profiles:  ${project.hasProfiles ? "Yes" : "No"}`);
  lines.push(`  Monitors:  ${project.hasMonitors ? "Yes" : "No"}`);

  // Features
  lines.push(...formatFeaturesList(project.features));

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mask a token for display
 */
export function maskToken(token: string): string {
  if (token.length <= 12) {
    return "****";
  }
  return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
}

/**
 * Format token expiration info
 */
export function formatExpiration(expiresAt: number): string {
  const expiresDate = new Date(expiresAt);
  const now = new Date();

  if (expiresDate <= now) {
    return "Expired";
  }

  const hoursRemaining = Math.round(
    (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60)
  );
  return `${expiresDate.toLocaleString()} (${hoursRemaining}h remaining)`;
}
