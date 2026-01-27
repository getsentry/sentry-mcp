/**
 * Sentry color palette for chart visualizations.
 * These colors are derived from Sentry's design system.
 */

export const SENTRY_COLORS = {
  // Primary brand colors
  purple: "#362D59",
  purpleLight: "#6C5FC7",
  purpleLighter: "#9D8BCF",

  // Series colors for charts (distinguishable, accessible)
  series: [
    "#6C5FC7", // Purple (primary)
    "#F9C33A", // Yellow
    "#FA5D35", // Orange
    "#45B5AA", // Teal
    "#F68BC1", // Pink
    "#7C5FC7", // Light Purple
    "#53B6F0", // Blue
    "#E8835D", // Coral
  ],

  // Semantic colors
  error: "#FA5D35",
  warning: "#F9C33A",
  success: "#45B5AA",
  info: "#53B6F0",

  // Neutral colors
  gray900: "#1D1127",
  gray700: "#3E3446",
  gray500: "#80708F",
  gray300: "#DBD6E1",
  gray100: "#F5F3F7",
  white: "#FFFFFF",
};

/**
 * Chart.js configuration defaults using Sentry theme
 */
export const CHART_DEFAULTS = {
  font: {
    family:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    size: 12,
  },
  colors: {
    text: SENTRY_COLORS.gray700,
    gridLines: SENTRY_COLORS.gray300,
    background: SENTRY_COLORS.white,
  },
};
