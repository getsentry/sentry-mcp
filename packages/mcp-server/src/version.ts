export const LIB_VERSION =
  (typeof process !== "undefined" && process.env?.npm_package_version) ||
  "0.0.0";

export const USER_AGENT = `sentry-mcp/${LIB_VERSION} (https://mcp.sentry.dev)`;
