/**
 * UI Resources for MCP Apps visualization.
 *
 * This module provides a registry of UI resources that can be served
 * to MCP Apps-capable clients for interactive visualizations.
 */

import { searchEventsChartHtml } from "@sentry/mcp-apps-ui";

/**
 * Registry of UI resources keyed by their resource URI.
 * The URI format follows the MCP Apps spec: ui://<namespace>/<path>
 */
export const UI_RESOURCES: Record<string, { html: string; name: string }> = {
  "ui://sentry/search-events-chart.html": {
    html: searchEventsChartHtml,
    name: "Search Events Chart",
  },
};
