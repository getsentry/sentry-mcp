/**
 * Browser utilities
 *
 * Cross-platform utilities for interacting with the user's browser.
 * Uses Bun.spawn and Bun.which for process management.
 */

/**
 * Open a URL in the user's default browser.
 *
 * This is a "best effort" operation - returns true if successful, false otherwise.
 * Never throws, so callers can safely attempt to open a browser without breaking flows.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const { platform } = process;

  let command: string | null = null;
  let args: string[];

  if (platform === "darwin") {
    command = Bun.which("open");
    args = [url];
  } else if (platform === "win32") {
    command = Bun.which("cmd");
    args = ["/c", "start", "", url];
  } else {
    // Linux and other Unix-like systems - try multiple openers
    const linuxOpeners = [
      "xdg-open",
      "sensible-browser",
      "x-www-browser",
      "gnome-open",
      "kde-open",
    ];
    for (const opener of linuxOpeners) {
      command = Bun.which(opener);
      if (command) {
        break;
      }
    }
    args = [url];
  }

  if (!command) {
    return false;
  }

  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Give browser time to open, then detach
    await Bun.sleep(500);
    proc.unref();
    return true;
  } catch {
    return false;
  }
}
