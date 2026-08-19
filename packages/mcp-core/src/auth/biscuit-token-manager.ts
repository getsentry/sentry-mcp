/**
 * Manages a biscuit agent token (sntryb_) lifecycle:
 * - Holds the current token
 * - Auto-refreshes at baseline scopes (auto-decay)
 * - Swaps to elevated token after user approval
 * - Provides session/org context for elevation requests
 */

import type { SentryProtocol } from "../types";
import { logWarn } from "../telem/logging";

export const BISCUIT_TOKEN_PREFIX = "sntryb_";

export interface BiscuitTokenInfo {
  token: string;
  expiresAt: string;
  scopes: string[];
  maxScopes: string[];
}

export interface BiscuitTokenManagerConfig {
  initialToken: BiscuitTokenInfo;
  organizationSlug: string;
  sessionId: string;
  sentryHost: string;
  sentryProtocol: SentryProtocol;
}

export class BiscuitTokenManager {
  private current: BiscuitTokenInfo;
  private sessionId: string;
  private organizationSlug: string;
  private sentryHost: string;
  private sentryProtocol: SentryProtocol;

  constructor(config: BiscuitTokenManagerConfig) {
    this.current = config.initialToken;
    this.sessionId = config.sessionId;
    this.organizationSlug = config.organizationSlug;
    this.sentryHost = config.sentryHost;
    this.sentryProtocol = config.sentryProtocol;
  }

  getCurrentToken(): string {
    return this.current.token;
  }

  getScopes(): string[] {
    return this.current.scopes;
  }

  getMaxScopes(): string[] {
    return this.current.maxScopes;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getOrganizationSlug(): string {
    return this.organizationSlug;
  }

  isElevated(): boolean {
    const baseline = new Set([
      "org:read",
      "project:read",
      "team:read",
      "event:read",
      "member:read",
    ]);
    return this.current.scopes.some((s) => !baseline.has(s));
  }

  swapToken(info: BiscuitTokenInfo): void {
    this.current = info;
  }

  async refresh(requestedScopes?: string[]): Promise<BiscuitTokenInfo | null> {
    const url = `${this.sentryProtocol}://${this.sentryHost}/api/0/organizations/${this.organizationSlug}/agent/biscuit-token/refresh/`;
    console.log(
      "[biscuit-refresh] calling refresh:",
      url,
      "requestedScopes:",
      requestedScopes,
    );
    try {
      const body: Record<string, unknown> = {};
      if (requestedScopes) {
        body.requestedScopes = requestedScopes;
      }
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.current.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => "<unreadable>");
        console.log(
          "[biscuit-refresh] refresh failed:",
          response.status,
          errBody,
        );
        return null;
      }
      const data = (await response.json()) as BiscuitTokenInfo;
      console.log("[biscuit-refresh] refresh succeeded, scopes:", data.scopes);
      this.current = data;
      return data;
    } catch (err) {
      console.log("[biscuit-refresh] refresh threw:", String(err));
      return null;
    }
  }

  /**
   * Refresh the token requesting elevated scopes (maxScopes).
   * If a write grant exists on the backend, the token comes back elevated.
   */
  async tryElevateViaRefresh(): Promise<boolean> {
    console.log(
      "[biscuit-refresh] tryElevateViaRefresh called, maxScopes:",
      this.current.maxScopes,
    );
    const result = await this.refresh(this.current.maxScopes);
    console.log(
      "[biscuit-refresh] refresh result:",
      result ? { scopes: result.scopes } : null,
    );
    if (!result) return false;
    return result.scopes.length > this.baselineCount();
  }

  private baselineCount(): number {
    const baseline = new Set([
      "org:read",
      "project:read",
      "team:read",
      "event:read",
      "member:read",
    ]);
    return baseline.size;
  }

  /**
   * Create an elevation request on the Sentry backend.
   * Returns the elevation ID and approval URL for URL elicitation.
   */
  async createElevationRequest(
    requestedScopes: string[],
  ): Promise<{ elevationId: string; url: string; expiresAt: string } | null> {
    const url = `${this.sentryProtocol}://${this.sentryHost}/api/0/organizations/${this.organizationSlug}/agent/biscuit-token/elevation/`;
    console.log("[biscuit-elevation] Creating elevation request:", url);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.current.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestedScopes }),
      });
      console.log(
        "[biscuit-elevation] Elevation response status:",
        response.status,
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "<unreadable>");
        console.log(
          "[biscuit-elevation] Elevation failed:",
          response.status,
          body,
        );
        logWarn(`Elevation request failed: ${response.status}`, {
          loggerScope: ["biscuit", "elevation"],
          extra: { status: response.status, body, url },
        });
        return null;
      }
      return (await response.json()) as {
        elevationId: string;
        url: string;
        expiresAt: string;
      };
    } catch (err) {
      logWarn("Elevation request threw", {
        loggerScope: ["biscuit", "elevation"],
        extra: { error: String(err), url },
      });
      return null;
    }
  }
}

export function isBiscuitToken(token: string): boolean {
  return token.startsWith(BISCUIT_TOKEN_PREFIX);
}
