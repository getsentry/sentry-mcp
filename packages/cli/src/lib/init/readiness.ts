/**
 * Setup Service Readiness Check
 *
 * Checks setup-service availability before entering the remote workflow and
 * warns when it may be slow or unreachable. Authentication is handled before
 * the wizard UI is created.
 */

import { customFetch } from "../custom-ca.js";
import { logger } from "../logger.js";
import { MASTRA_API_URL } from "./constants.js";
import type { WizardUI } from "./ui/types.js";

/** Timeout for the health check fetch (5 seconds). */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Setup-service behavior negotiated before the remote workflow starts. */
export type InitServiceCapabilities = {
  /** The API preserves and upgrades an already-installed Sentry setup. */
  improveExistingSetup: boolean;
};

type ReadinessResult = {
  apiOk: boolean;
  capabilities: InitServiceCapabilities;
};

/**
 * Check whether the setup service is reachable before starting the workflow.
 * Authentication is resolved before the wizard UI is created so recoverable
 * OAuth failures can use the CLI's global auto-auth flow.
 */
export async function checkReadiness(
  ui: WizardUI
): Promise<InitServiceCapabilities> {
  const spin = ui.spinner();
  spin.start("Checking prerequisites...");

  const { apiOk, capabilities } = await checkMastraApi();

  if (apiOk) {
    spin.stop("");
  } else {
    spin.stop("Warning", 2);
    ui.log.warn(
      "Setup service may be slow or unreachable. The wizard will retry if needed."
    );
  }
  return capabilities;
}

async function checkMastraApi(): Promise<ReadinessResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const resp = await customFetch(`${MASTRA_API_URL}/health`, {
      signal: controller.signal,
      method: "GET",
    });
    if (!resp.ok) {
      return {
        apiOk: false,
        capabilities: { improveExistingSetup: false },
      };
    }
    const body = (await resp.json().catch(() => null)) as {
      capabilities?: unknown;
    } | null;
    const advertised = Array.isArray(body?.capabilities)
      ? body.capabilities
      : [];
    return {
      apiOk: true,
      capabilities: {
        improveExistingSetup: advertised.includes("improve-existing-setup"),
      },
    };
  } catch (error) {
    logger.withTag("readiness").debug("Mastra API health check failed", error);
    return {
      apiOk: false,
      capabilities: { improveExistingSetup: false },
    };
  } finally {
    clearTimeout(timer);
  }
}
