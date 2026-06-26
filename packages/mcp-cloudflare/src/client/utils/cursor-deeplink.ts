/**
 * Generates a Cursor deep link for MCP server installation.
 * @param endpoint - The MCP endpoint URL (defaults to current origin + /mcp)
 * @returns The cursor:// deep link URL
 */
export function getCursorDeepLink(endpoint?: string): string {
  const url = endpoint ?? new URL("/mcp", window.location.href).href;
  const config = btoa(JSON.stringify({ url }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=Sentry&config=${encodeURIComponent(config)}`;
}

/**
 * Navigates to Cursor via deep link, with fallback to anchor if Cursor isn't installed.
 * @param endpoint - The MCP endpoint URL (defaults to current origin + /mcp)
 * @param fallbackAnchor - The anchor to navigate to if Cursor doesn't open (default: #getting-started)
 */
export function openCursorDeepLink(
  endpoint?: string,
  fallbackAnchor = "#getting-started",
): void {
  const clickedTime = Date.now();
  const deepLink = getCursorDeepLink(endpoint);
  window.location.href = deepLink;

  // Fallback if Cursor is not installed
  const timeout = setTimeout(() => {
    if (document.hasFocus() && Date.now() - clickedTime < 2000) {
      window.location.href = fallbackAnchor;
    }
  }, 123);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(timeout);
      }
    },
    { once: true },
  );
}
