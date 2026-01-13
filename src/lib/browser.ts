/**
 * Browser utilities
 *
 * Cross-platform utilities for interacting with the user's browser.
 * Uses Bun.spawn and Bun.which for process management.
 */

/**
 * Open a URL in the user's default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const { platform } = process;

  let command: string | null;
  let args: string[];

  if (platform === "darwin") {
    command = Bun.which("open");
    args = [url];
  } else if (platform === "win32") {
    command = Bun.which("cmd");
    args = ["/c", "start", "", url];
  } else {
    // Linux and other Unix-like systems
    command = Bun.which("xdg-open");
    args = [url];
  }

  if (!command) {
    throw new Error(
      `Could not find browser opener command for platform: ${platform}`
    );
  }

  const proc = Bun.spawn([command, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });

  // Give browser time to open, then detach
  await Bun.sleep(500);
  proc.unref();
}
