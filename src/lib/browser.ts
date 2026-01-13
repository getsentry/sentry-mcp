/**
 * Browser utilities
 *
 * Cross-platform utilities for interacting with the user's browser.
 */

/**
 * Open a URL in the user's default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const { platform } = process;
  const { spawn } = await import("node:child_process");

  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  return new Promise((resolve) => {
    const proc = spawn(command, args, { detached: true, stdio: "ignore" });
    proc.unref();
    setTimeout(resolve, 500);
  });
}
