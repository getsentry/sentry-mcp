import { App } from "@modelcontextprotocol/ext-apps";
import { Chart, registerables } from "chart.js";
import { SENTRY_COLORS, CHART_DEFAULTS } from "../../shared/sentry-theme";
import type { ChartData, ChartType } from "../../shared/chart-data";
import { inferChartType } from "../../shared/chart-data";

// Register all Chart.js components
Chart.register(...registerables);

// Apply global chart defaults
Chart.defaults.font.family = CHART_DEFAULTS.font.family;
Chart.defaults.font.size = CHART_DEFAULTS.font.size;
Chart.defaults.color = CHART_DEFAULTS.colors.text;

const app = new App({ name: "Sentry Search Events Chart", version: "1.0.0" });

let currentChart: Chart | null = null;

/**
 * Parse chart data from tool result content
 */
function parseChartData(result: {
  content?: Array<{
    type: string;
    resource?: { mimeType?: string; text?: string };
  }>;
}): ChartData | null {
  // Find the JSON resource containing chart data
  const chartResource = result.content?.find(
    (c) =>
      c.type === "resource" &&
      c.resource?.mimeType === "application/json;chart",
  );

  if (!chartResource?.resource?.text) {
    return null;
  }

  try {
    return JSON.parse(chartResource.resource.text) as ChartData;
  } catch {
    console.error("Failed to parse chart data");
    return null;
  }
}

/**
 * Format a number for display (with thousands separators)
 */
function formatNumber(value: unknown): string {
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  return String(value);
}

/**
 * Render a single number display
 */
function renderNumberDisplay(data: ChartData): void {
  const content = document.getElementById("content");
  if (!content) return;

  const value = data.data[0]?.[data.values[0]];

  content.innerHTML = `
    <div class="number-display">
      <div class="number-value">${formatNumber(value)}</div>
      <div class="number-label">${data.values[0]}</div>
    </div>
  `;
}

/**
 * Render a data table
 */
function renderTable(data: ChartData): void {
  const content = document.getElementById("content");
  if (!content) return;

  const allColumns = [...data.labels, ...data.values];

  let tableHtml = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            ${allColumns.map((col) => `<th>${col}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
  `;

  for (const row of data.data) {
    tableHtml += "<tr>";
    for (const col of allColumns) {
      const value = row[col];
      tableHtml += `<td>${formatNumber(value)}</td>`;
    }
    tableHtml += "</tr>";
  }

  tableHtml += `
        </tbody>
      </table>
    </div>
  `;

  content.innerHTML = tableHtml;
}

/**
 * Render a Chart.js chart
 */
function renderChart(data: ChartData, chartType: ChartType): void {
  const content = document.getElementById("content");
  if (!content) return;

  // Clean up existing chart
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }

  content.innerHTML = `
    <div class="chart-container">
      <canvas id="chart"></canvas>
    </div>
  `;

  const canvas = document.getElementById("chart") as HTMLCanvasElement;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Extract labels (x-axis values)
  const labelField = data.labels[0] || "label";
  const labels = data.data.map((d) => String(d[labelField] || "Unknown"));

  // Extract values (y-axis datasets)
  const datasets = data.values.map((valueField, index) => ({
    label: valueField,
    data: data.data.map((d) => {
      const val = d[valueField];
      return typeof val === "number" ? val : 0;
    }),
    backgroundColor:
      chartType === "pie"
        ? data.data.map(
            (_, i) => SENTRY_COLORS.series[i % SENTRY_COLORS.series.length],
          )
        : SENTRY_COLORS.series[index % SENTRY_COLORS.series.length],
    borderColor:
      chartType === "line"
        ? SENTRY_COLORS.series[index % SENTRY_COLORS.series.length]
        : undefined,
    borderWidth: chartType === "line" ? 2 : 0,
    fill: chartType === "line" ? false : undefined,
    tension: chartType === "line" ? 0.3 : undefined,
  }));

  // Map our chart types to Chart.js types (number/table are handled separately)
  const chartJsTypeMap: Record<string, "bar" | "pie" | "line"> = {
    pie: "pie",
    line: "line",
  };
  const chartJsType = chartJsTypeMap[chartType] ?? "bar";

  currentChart = new Chart(ctx, {
    type: chartJsType,
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: datasets.length > 1 || chartType === "pie",
          position: chartType === "pie" ? "right" : "top",
        },
        title: {
          display: false,
        },
      },
      scales:
        chartType === "pie"
          ? {}
          : {
              x: {
                grid: {
                  color: CHART_DEFAULTS.colors.gridLines,
                },
              },
              y: {
                beginAtZero: true,
                grid: {
                  color: CHART_DEFAULTS.colors.gridLines,
                },
              },
            },
    },
  });
}

/**
 * Main render function
 */
function render(data: ChartData): void {
  const title = document.getElementById("title");
  const subtitle = document.getElementById("subtitle");

  if (title) {
    title.textContent = data.query;
  }

  if (subtitle) {
    subtitle.textContent = `${data.data.length} result${data.data.length === 1 ? "" : "s"}`;
  }

  // Determine chart type (use provided or infer)
  const chartType: ChartType =
    data.chartType || inferChartType(data.data, data.labels, data.values);

  switch (chartType) {
    case "number":
      renderNumberDisplay(data);
      break;
    case "table":
      renderTable(data);
      break;
    default:
      renderChart(data, chartType);
  }
}

/**
 * Show error message
 */
function showError(message: string): void {
  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = `<div class="error">${message}</div>`;
  }
}

// Handle tool results from the server
app.ontoolresult = (result) => {
  const chartData = parseChartData(result);

  if (chartData) {
    render(chartData);
  } else {
    showError("No chart data available in the tool response.");
  }
};

// Connect to the host
app.connect().catch((error) => {
  console.error("Failed to connect to MCP host:", error);
  showError("Failed to connect to visualization host.");
});
