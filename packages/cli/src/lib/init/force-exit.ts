/**
 * macOS/Bun can retain the fresh `/dev/tty` handle used by the init UI after
 * teardown. Track when init is about to enter the wizard, then schedule the
 * existing force-exit safety net only after the CLI's outer recovery
 * middleware has finished. This keeps OAuth login/retry alive while still
 * covering success, cancellation, and terminal error paths.
 */

let initForceExitRequested = false;

/** Mark that an init run may need the macOS force-exit safety net. */
export function requestInitForceExit(): void {
  initForceExitRequested = true;
}

/**
 * Schedule the requested safety net after all CLI recovery middleware has
 * completed. The unref'd timer only fires when another handle keeps the event
 * loop alive, so it remains a no-op on normal exits.
 */
export function scheduleInitForceExitIfRequested(): void {
  if (!initForceExitRequested) {
    return;
  }
  initForceExitRequested = false;

  if (process.platform === "darwin" && process.env.NODE_ENV !== "test") {
    setTimeout(() => {
      process.exit(process.exitCode ?? 0);
    }, 100).unref();
  }
}
