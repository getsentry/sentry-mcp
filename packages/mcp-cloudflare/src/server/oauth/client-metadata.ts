import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";

const CODEX_CLIENT_ID = "https://chatgpt.com/oauth/codex/client.json";

/**
 * Operator-managed client registration avoids an upstream metadata outage
 * blocking authorization or refresh. Keep the exact client ID and redirect
 * URIs in sync with the official document; never derive them from a request.
 * Source: https://chatgpt.com/oauth/codex/client.json (verified 2026-09-16).
 */
export const CLIENT_ID_METADATA_DOCUMENTS = {
  [CODEX_CLIENT_ID]: {
    client_id: CODEX_CLIENT_ID,
    client_uri: "https://chatgpt.com/codex",
    application_type: "native",
    redirect_uris: ["http://127.0.0.1/callback", "http://localhost/callback"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods_supported: ["none"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Codex",
    logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
  },
} as const satisfies NonNullable<
  OAuthProviderOptions["clientIdMetadataDocuments"]
>;
