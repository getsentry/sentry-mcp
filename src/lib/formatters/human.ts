/**
 * Human-readable output formatters
 *
 * Centralized formatting utilities for consistent CLI output.
 * Follows gh cli patterns for alignment and presentation.
 */

import type {
  SentryEvent,
  SentryIssue,
  SentryOrganization,
  SentryProject,
} from "../../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status Formatting
// ─────────────────────────────────────────────────────────────────────────────

type IssueStatus = "resolved" | "unresolved" | "ignored";

const STATUS_ICONS: Record<IssueStatus, string> = {
  resolved: "✓",
  unresolved: "●",
  ignored: "−",
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  resolved: "✓ Resolved",
  unresolved: "● Unresolved",
  ignored: "− Ignored",
};

/**
 * Get status icon for an issue status
 */
export function formatStatusIcon(status: string): string {
  return STATUS_ICONS[status as IssueStatus] ?? "●";
}

/**
 * Get full status label for an issue status
 */
export function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status as IssueStatus] ?? "● Unknown";
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
  return char.repeat(length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a single issue for list display (one line)
 */
export function formatIssueRow(issue: SentryIssue): string {
  const status = formatStatusIcon(issue.status);
  const level = issue.level.toUpperCase().padEnd(7);
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
    "═".repeat(Math.min(80, issue.title.length + issue.shortId.length + 2))
  );
  lines.push("");

  // Status and level
  lines.push(`Status:     ${formatStatusLabel(issue.status)}`);
  lines.push(`Level:      ${issue.level}`);
  lines.push(`Platform:   ${issue.platform}`);
  lines.push(`Type:       ${issue.type}`);
  lines.push("");

  // Project
  lines.push(`Project:    ${issue.project.name} (${issue.project.slug})`);
  lines.push("");

  // Stats
  lines.push(`Events:     ${issue.count}`);
  lines.push(`Users:      ${issue.userCount}`);
  lines.push(`First seen: ${new Date(issue.firstSeen).toLocaleString()}`);
  lines.push(`Last seen:  ${new Date(issue.lastSeen).toLocaleString()}`);
  lines.push("");

  // Culprit
  if (issue.culprit) {
    lines.push(`Culprit:    ${issue.culprit}`);
    lines.push("");
  }

  // Metadata
  if (issue.metadata.value) {
    lines.push("Message:");
    lines.push(`  ${issue.metadata.value}`);
    lines.push("");
  }

  if (issue.metadata.filename) {
    lines.push(`File:       ${issue.metadata.filename}`);
  }
  if (issue.metadata.function) {
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
  lines.push(`─── ${header} ───`);
  lines.push("");
  lines.push(`Event ID:   ${event.eventID}`);
  lines.push(`Received:   ${new Date(event.dateReceived).toLocaleString()}`);

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

  if (event.tags.length > 0) {
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
