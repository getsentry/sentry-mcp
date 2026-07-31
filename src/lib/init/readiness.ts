/**
 * Pre-Flight Readiness Check
 *
 * Verifies critical dependencies before entering the wizard flow.
 * Fails fast with actionable errors instead of failing mid-run.
 */

import { customFetch } from "../custom-ca.js";
import { getAuthToken } from "../db/auth.js";
import { WizardError } from "../errors.js";
import { logger } from "../logger.js";
import { MASTRA_API_URL } from "./constants.js";
import type { WizardUI } from "./ui/types.js";

/** Timeout for the health check fetch (5 seconds). */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Run pre-flight checks: auth token present, Mastra API reachable.
 * Throws `WizardError` on hard failures; logs warnings for soft issues.
 */
export async function checkReadiness(ui: WizardUI): Promise<void> {
  const spin = ui.spinner();
  spin.start("Checking prerequisites...");

  const [authResult, apiResult] = await Promise.allSettled([
    checkAuth(),
    checkMastraApi(),
  ]);

  const authOk = authResult.status === "fulfilled" && authResult.value;
  const apiOk = apiResult.status === "fulfilled" && apiResult.value;

  if (!(authOk || apiOk)) {
    spin.stop("Prerequisites failed", 1);
    ui.log.error("Authentication and setup service are both unavailable.");
    ui.log.info("Run `sentry auth login` to authenticate.");
    ui.log.info("Check your network connection and try again.");
    ui.cancel("Setup failed");
    ui.feedback("failed");
    throw new WizardError("Pre-flight checks failed");
  }

  if (!authOk) {
    spin.stop("Prerequisites failed", 1);
    ui.log.error("No authentication token found.");
    ui.log.info("Run `sentry auth login` to authenticate, then try again.");
    ui.cancel("Setup failed");
    ui.feedback("failed");
    throw new WizardError("Not authenticated");
  }

  if (apiOk) {
    spin.stop("");
  } else {
    spin.stop("Warning", 2);
    ui.log.warn(
      "Setup service may be slow or unreachable. The wizard will retry if needed."
    );
  }
}

async function checkAuth(): Promise<boolean> {
  const token = await getAuthToken();
  return token !== undefined && token !== "";
}

async function checkMastraApi(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const resp = await customFetch(`${MASTRA_API_URL}/health`, {
      signal: controller.signal,
      method: "GET",
    });
    return resp.ok;
  } catch (error) {
    logger.withTag("readiness").debug("Mastra API health check failed", error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
