const AUTH_PARAM_SEPARATOR = /,\s*(?=[A-Za-z_][A-Za-z0-9_-]*\s*=)/;
const AUTH_CHALLENGE = /^(\S+)(?:\s+(.+))?$/;

export type OAuthTokenShape =
  | "missing"
  | "non_bearer"
  | "empty_bearer"
  | "wrapper"
  | "malformed";

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_token"
  | "invalid_target"
  | "unsupported_grant_type"
  | "invalid_client_metadata"
  | "not_implemented"
  | "other";

export type OAuthErrorTelemetry = {
  oauthError?: OAuthErrorCode;
  oauthErrorDescription?: string;
  oauthTokenShape?: OAuthTokenShape;
};

/**
 * Buckets OAuth error codes before they become span or metric attributes.
 */
export function bucketOAuthErrorCode(
  value: unknown,
): OAuthErrorCode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, "_");

  switch (normalized) {
    case "invalid_request":
    case "invalid_client":
    case "invalid_grant":
    case "invalid_token":
    case "invalid_target":
    case "unsupported_grant_type":
    case "invalid_client_metadata":
    case "not_implemented":
      return normalized;
    default:
      return normalized ? "other" : undefined;
  }
}

/**
 * Buckets OAuth error descriptions into stable diagnostic categories.
 */
export function bucketOAuthErrorDescription(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (normalized.includes("missing or invalid access token")) {
    return "missing_or_invalid_access_token";
  }
  if (normalized.includes("missing, invalid, or expired access token")) {
    return "missing_invalid_or_expired_access_token";
  }
  if (normalized.includes("invalid access token")) {
    return "invalid_access_token";
  }
  if (normalized.includes("access token expired")) {
    return "access_token_expired";
  }
  if (normalized.includes("audience does not match")) {
    return "token_audience_mismatch";
  }
  if (normalized.includes("grant not found")) {
    return "grant_not_found";
  }
  if (normalized.includes("invalid refresh token")) {
    return "invalid_refresh_token";
  }
  if (normalized.includes("content-type")) {
    return "invalid_content_type";
  }
  if (normalized.includes("client id is required")) {
    return "missing_client_id";
  }

  return "other";
}

function parseAuthenticateParams(
  headerValue: string | null,
): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  const match = headerValue.match(AUTH_CHALLENGE);
  if (!match) {
    return {};
  }

  const [, , params = ""] = match;
  const parsed: Record<string, string> = {};

  for (const part of params.split(AUTH_PARAM_SEPARATOR)) {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    if (!key || rawValueParts.length === 0) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();
    parsed[key] = rawValue.replace(/^"|"$/g, "");
  }

  return parsed;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function parseResponseJsonBody(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    return parseJsonObject(await response.clone().text());
  } catch {
    return null;
  }
}

/**
 * Classifies the bearer token shape without exposing the token value.
 */
export function getOAuthTokenShape(request: Request): OAuthTokenShape {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return "missing";
  }

  const match = authHeader.match(/^Bearer\s*(.*)$/i);
  if (!match) {
    return "non_bearer";
  }

  const token = match[1]?.trim();
  if (!token) {
    return "empty_bearer";
  }

  const parts = token.split(":");
  if (parts.length === 3 && parts.every(Boolean)) {
    return "wrapper";
  }

  return "malformed";
}

function fingerprintOAuthGrantId(grantId: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < grantId.length; i++) {
    hash ^= grantId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Projects a grant ID into non-secret log fields for session correlation.
 */
export function getOAuthGrantTelemetry(
  grantId: string | null,
): Record<string, string> {
  return grantId
    ? { "app.oauth.grant.id_hash": fingerprintOAuthGrantId(grantId) }
    : {};
}

/**
 * Extracts best-effort OAuth error telemetry from an error response.
 */
export async function getOAuthErrorTelemetry(
  request: Request,
  response: Response,
): Promise<OAuthErrorTelemetry> {
  const telemetry: OAuthErrorTelemetry = {};

  if (response.status === 401) {
    telemetry.oauthTokenShape = getOAuthTokenShape(request);
  }

  const authenticateParams = parseAuthenticateParams(
    response.headers.get("WWW-Authenticate"),
  );
  const headerError = bucketOAuthErrorCode(authenticateParams.error);
  if (headerError) {
    telemetry.oauthError = headerError;
    telemetry.oauthErrorDescription = bucketOAuthErrorDescription(
      authenticateParams.error_description,
    );
    if (!telemetry.oauthErrorDescription) {
      const json = await parseResponseJsonBody(response);
      telemetry.oauthErrorDescription = bucketOAuthErrorDescription(
        json?.error_description,
      );
    }
    return telemetry;
  }

  const json = await parseResponseJsonBody(response);
  if (!json) {
    return telemetry;
  }

  const bodyError = bucketOAuthErrorCode(json.error);
  if (!bodyError) {
    return telemetry;
  }

  telemetry.oauthError = bodyError;
  telemetry.oauthErrorDescription = bucketOAuthErrorDescription(
    json.error_description,
  );
  return telemetry;
}
