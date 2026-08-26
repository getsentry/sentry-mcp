/**
 * Dashboard sixel integration tests.
 *
 * Stubs `canRenderSixel` and `terminalPixelWidth` so the dashboard formatter
 * takes the sixel rendering path deterministically, then verifies that the
 * output contains one sixel DCS sequence for the complete dashboard grid.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type DashboardViewData,
  type DashboardViewWidget,
  formatDashboardWithData,
} from "../../../src/lib/formatters/dashboard.js";
// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as sixelModule from "../../../src/lib/sixel.js";
import type { TimeseriesResult } from "../../../src/types/dashboard.js";

const ESC = "\x1b";

function makeTimeseries(
  overrides: Partial<TimeseriesResult> = {}
): TimeseriesResult {
  return {
    type: "timeseries",
    series: [
      {
        label: "count()",
        values: [
          { timestamp: 1_700_000_000, value: 10 },
          { timestamp: 1_700_000_060, value: 20 },
          { timestamp: 1_700_000_120, value: 15 },
          { timestamp: 1_700_000_180, value: 30 },
        ],
      },
    ],
    ...overrides,
  };
}

function makeWidget(
  overrides: Partial<DashboardViewWidget> = {}
): DashboardViewWidget {
  return {
    title: "Test Widget",
    displayType: "line",
    data: makeTimeseries(),
    ...overrides,
  };
}

function makeDashboardData(
  overrides: Partial<DashboardViewData> = {}
): DashboardViewData {
  return {
    id: "12345",
    title: "My Dashboard",
    period: "24h",
    fetchedAt: "2024-01-15T10:30:00Z",
    url: "https://sentry.io/organizations/test-org/dashboard/12345/",
    environment: ["production"],
    widgets: [makeWidget()],
    ...overrides,
  };
}

describe("dashboard sixel integration", () => {
  let savedPlainOutput: string | undefined;
  let savedColumns: number | undefined;

  beforeEach(() => {
    savedPlainOutput = process.env.SENTRY_PLAIN_OUTPUT;
    savedColumns = process.stdout.columns;
    process.env.SENTRY_PLAIN_OUTPUT = "0";
    process.stdout.columns = 40;
    vi.spyOn(sixelModule, "canRenderSixel").mockReturnValue(true);
    vi.spyOn(sixelModule, "canRenderKitty").mockReturnValue(false);
    vi.spyOn(sixelModule, "terminalPixelWidth").mockReturnValue(320);
    vi.spyOn(sixelModule, "terminalPixelHeight").mockReturnValue(12);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedPlainOutput === undefined) {
      delete process.env.SENTRY_PLAIN_OUTPUT;
    } else {
      process.env.SENTRY_PLAIN_OUTPUT = savedPlainOutput;
    }
    process.stdout.columns = savedColumns;
  });

  test("renders one sixel canvas for a timeseries widget when enabled", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Sixel Chart",
          displayType: "line",
          layout: { x: 0, y: 0, w: 6, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    expect(output).toContain(`${ESC}P`);
    expect(output).toContain(`${ESC}\\`);
    expect(output.split(`${ESC}P`)).toHaveLength(2);
    expect(output).toContain('"1;1;320;144');
  });

  test("prefers kitty encoding when the terminal supports it", () => {
    vi.spyOn(sixelModule, "canRenderKitty").mockReturnValue(true);
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Kitty Chart",
          displayType: "line",
          layout: { x: 0, y: 0, w: 6, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    // Kitty graphics use the APC introducer ESC _ G, not the sixel DCS ESC P.
    expect(output).toContain(`${ESC}_G`);
    expect(output).not.toContain(`${ESC}P`);
  });

  test("renders scalar and timeseries widgets in the same sixel canvas", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Big Number",
          displayType: "big_number",
          data: { type: "scalar", value: 42 },
          layout: { x: 0, y: 0, w: 3, h: 1 },
        }),
        makeWidget({
          title: "Sixel Chart",
          displayType: "line",
          layout: { x: 3, y: 0, w: 3, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    expect(output).toContain(`${ESC}P`);
    expect(output).toContain(`${ESC}\\`);
    expect(output.split(`${ESC}P`)).toHaveLength(2);
    expect(output).not.toContain("Big Number");
    expect(output).not.toContain("Sixel Chart");
  });

  test("renders every non-chart widget type inside the sixel canvas", () => {
    const output = formatDashboardWithData(
      makeDashboardData({
        widgets: [
          makeWidget({
            title: "Table Widget",
            displayType: "table",
            layout: { x: 0, y: 0, w: 3, h: 1 },
            data: {
              type: "table",
              columns: [{ name: "count" }],
              rows: [{ count: 42 }],
            },
          }),
          makeWidget({
            title: "Text Widget",
            displayType: "text",
            layout: { x: 3, y: 0, w: 3, h: 1 },
            data: { type: "text", content: "Dashboard note" },
          }),
          makeWidget({
            title: "Failed Widget",
            displayType: "line",
            layout: { x: 0, y: 1, w: 3, h: 1 },
            data: { type: "error", message: "Query failed" },
          }),
          makeWidget({
            title: "Unsupported Widget",
            displayType: "wheel",
            layout: { x: 3, y: 1, w: 3, h: 1 },
            data: { type: "unsupported", reason: "Not implemented" },
          }),
        ],
      })
    );

    expect(output.split(`${ESC}P`)).toHaveLength(2);
    expect(output).not.toContain("Table Widget");
    expect(output).not.toContain("Dashboard note");
    expect(output).not.toContain("Query failed");
    expect(output).not.toContain("Unsupported Widget");
  });

  test("renders categorical_bar widgets as sixel bars", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Categorical",
          displayType: "categorical_bar",
          layout: { x: 0, y: 0, w: 6, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    expect(output).toContain(`${ESC}P`);
    expect(output).toContain(`${ESC}\\`);
  });

  test("preserves side-by-side widget layout in one sixel canvas", () => {
    const data = makeDashboardData({
      widgets: [
        makeWidget({
          title: "Big Number",
          displayType: "big_number",
          data: { type: "scalar", value: 42 },
          layout: { x: 0, y: 0, w: 3, h: 2 },
        }),
        makeWidget({
          title: "Sixel Chart",
          displayType: "line",
          layout: { x: 3, y: 0, w: 3, h: 2 },
        }),
      ],
    });

    const output = formatDashboardWithData(data);
    // A DCS sequence reserves one full 320x144 pixel dashboard grid, so two
    // adjacent widgets always share their original row instead of serializing.
    expect(output).toContain('"1;1;320;144');
    expect(output.split(`${ESC}P`)).toHaveLength(2);
  });

  test("preserves wide terminal canvas width", () => {
    vi.mocked(sixelModule.terminalPixelWidth).mockReturnValue(1024);
    const output = formatDashboardWithData(
      makeDashboardData({
        widgets: [makeWidget({ layout: { x: 0, y: 0, w: 6, h: 1 } })],
      })
    );

    expect(output).toContain('"1;1;1024;72');
  });

  test("uses the actual narrow terminal width for the sixel canvas", () => {
    vi.mocked(sixelModule.terminalPixelWidth).mockReturnValue(320);
    const output = formatDashboardWithData(
      makeDashboardData({
        widgets: [makeWidget({ layout: { x: 0, y: 0, w: 6, h: 1 } })],
      })
    );

    expect(output).toContain('"1;1;320;72');
  });

  test("keeps charts inside exceptionally narrow widget bounds", () => {
    process.stdout.columns = 4;
    vi.mocked(sixelModule.terminalPixelWidth).mockReturnValue(32);
    const output = formatDashboardWithData(
      makeDashboardData({
        widgets: [
          makeWidget({ layout: { x: 0, y: 0, w: 1, h: 1 } }),
          makeWidget({
            title: "Neighbor",
            layout: { x: 1, y: 0, w: 1, h: 1 },
          }),
        ],
      })
    );

    expect(output).toContain('"1;1;32;72');
  });

  test("falls back to the complete character dashboard without cell geometry", () => {
    vi.mocked(sixelModule.terminalPixelHeight).mockReturnValue(undefined);
    const output = formatDashboardWithData(
      makeDashboardData({
        widgets: [
          makeWidget({
            title: "Fallback Widget",
            layout: { x: 0, y: 0, w: 6, h: 1 },
          }),
        ],
      })
    );

    expect(output).not.toContain(`${ESC}P`);
    expect(output).toContain("Fallback Widget");
  });
});
