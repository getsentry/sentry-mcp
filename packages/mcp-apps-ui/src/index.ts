/**
 * MCP Apps UI - Interactive visualizations for Sentry MCP
 *
 * This module exports bundled HTML apps that can be served as UI resources
 * via the MCP Apps protocol.
 *
 * Usage in mcp-core:
 * ```typescript
 * import { searchEventsChartHtml } from "@sentry/mcp-apps-ui";
 *
 * server.resource(
 *   "ui://sentry/search-events-chart.html",
 *   "Search Events Chart UI",
 *   { mimeType: RESOURCE_MIME_TYPE },
 *   async () => ({
 *     contents: [{
 *       uri: "ui://sentry/search-events-chart.html",
 *       mimeType: RESOURCE_MIME_TYPE,
 *       text: searchEventsChartHtml
 *     }]
 *   })
 * );
 * ```
 */

// Note: Actual exports are generated at build time by bundle-apps.ts
// This file serves as documentation and for TypeScript development

export type { ChartData, ChartType } from "./shared/chart-data";
export { inferChartType } from "./shared/chart-data";

// The following are generated at build time:
// export const searchEventsChartHtml: string;
