import type { BiscuitTokenInfo } from "@sentry/mcp-core/auth";

interface MintOptions {
  accessToken: string;
  organizationSlug: string;
  sessionId: string;
  sentryHost: string;
  sentryProtocol: string;
}

export async function mintBiscuitToken(
  opts: MintOptions,
): Promise<BiscuitTokenInfo> {
  const url = `${opts.sentryProtocol}://${opts.sentryHost}/api/0/organizations/${opts.organizationSlug}/agent/biscuit-token/`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId: opts.sessionId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to mint biscuit token (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    token: string;
    expiresAt: string;
    scopes: string[];
    maxScopes: string[];
  };
  return {
    token: data.token,
    expiresAt: data.expiresAt,
    scopes: data.scopes,
    maxScopes: data.maxScopes,
  };
}
