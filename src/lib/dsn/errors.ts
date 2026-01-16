/**
 * DSN Error Messages
 *
 * User-friendly error messages for DSN detection failures.
 * Provides helpful context and suggestions for resolving issues.
 */

import { getDsnSourceDescription } from "./detector.js";
import { SENTRY_DSN_ENV } from "./env.js";
import { getAccessibleProjects } from "./resolver.js";
import type { DsnDetectionResult } from "./types.js";

/**
 * Format error message when multiple conflicting DSNs are detected
 *
 * Shows all detected DSNs and suggests how to resolve the conflict.
 *
 * @param result - Detection result with conflict
 * @returns Formatted error message
 */
export function formatConflictError(result: DsnDetectionResult): string {
  const lines = ["Error: Multiple Sentry DSNs detected in this project.\n"];

  result.all.forEach((dsn, i) => {
    lines.push(`  DSN ${i + 1}: ${dsn.raw}`);
    lines.push(`         Source: ${getDsnSourceDescription(dsn)}`);
    if (dsn.projectId) {
      lines.push(`         Project ID: ${dsn.projectId}`);
    }
    lines.push("");
  });

  lines.push("To resolve, specify which project to use:");
  lines.push("  sentry issue list --org <org> --project <project>");
  lines.push("");
  lines.push("Or set a default project:");
  lines.push("  sentry config set defaults.org <org>");
  lines.push("  sentry config set defaults.project <project>");

  return lines.join("\n");
}

/**
 * Format error message when no DSN is found
 *
 * Shows what was searched and suggests how to configure.
 * Optionally fetches and shows accessible projects from API.
 *
 * @param cwd - Directory that was searched
 * @param showProjects - Whether to fetch and show accessible projects
 * @returns Formatted error message
 */
export async function formatNoDsnError(
  cwd: string,
  showProjects = true
): Promise<string> {
  const lines = [
    `No Sentry DSN detected in ${cwd}\n`,
    "Searched:",
    `  - ${SENTRY_DSN_ENV} environment variable`,
    "  - .env files (.env, .env.local, .env.development, etc.)",
    "  - JavaScript/TypeScript source code (Sentry.init patterns)",
    "",
  ];

  // Try to fetch and show accessible projects
  if (showProjects) {
    try {
      const projects = await getAccessibleProjects();

      if (projects.length > 0) {
        lines.push("Your accessible projects:");
        for (const p of projects) {
          lines.push(`  - ${p.org}/${p.project}`);
        }
        lines.push("");
      }
    } catch {
      // Not authenticated or API error - skip project list
    }
  }

  lines.push("To use this command, either:");
  lines.push("");
  lines.push("1. Add SENTRY_DSN to your environment:");
  lines.push("   export SENTRY_DSN=https://key@o123.ingest.sentry.io/456");
  lines.push("");
  lines.push("2. Add SENTRY_DSN to a .env file:");
  lines.push(
    "   echo 'SENTRY_DSN=https://key@o123.ingest.sentry.io/456' >> .env"
  );
  lines.push("");
  lines.push("3. Specify project explicitly:");
  lines.push("   sentry issue list --org <org> --project <project>");
  lines.push("");
  lines.push("4. Set default project:");
  lines.push("   sentry config set defaults.org <org>");
  lines.push("   sentry config set defaults.project <project>");

  return lines.join("\n");
}

/**
 * Format error message for resolution failures
 *
 * @param error - Error that occurred during resolution
 * @param dsn - DSN that failed to resolve
 * @returns Formatted error message
 */
export function formatResolutionError(error: Error, dsnRaw: string): string {
  const lines = [
    "Error: Could not resolve project from DSN.\n",
    `DSN: ${dsnRaw}`,
    `Error: ${error.message}`,
    "",
    "This may happen if:",
    "  - You don't have access to this project",
    "  - The DSN is for a self-hosted Sentry instance",
    "  - The DSN is invalid or expired",
    "",
    "Try specifying the project explicitly:",
    "  sentry issue list --org <org> --project <project>",
  ];

  return lines.join("\n");
}
