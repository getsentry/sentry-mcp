import type {
  AuthRequest,
  ClientInfo,
} from "@cloudflare/workers-oauth-provider";
import { logError, logIssue, logWarn } from "@sentry/mcp-server/telem/logging";
import { sanitizeHtml } from "./html-utils";
import skillDefinitions, {
  type SkillDefinition,
} from "@sentry/mcp-server/skillDefinitions";

const COOKIE_NAME = "mcp-approved-clients";
const ONE_YEAR_IN_SECONDS = 31536000;
/**
 * Imports a secret key string for HMAC-SHA256 signing.
 * @param secret - The raw secret key string.
 * @returns A promise resolving to the CryptoKey object.
 */
async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error(
      "COOKIE_SECRET is not defined. A secret key is required for signing cookies.",
    );
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, // not extractable
    ["sign", "verify"], // key usages
  );
}

/**
 * Signs data using HMAC-SHA256.
 * @param key - The CryptoKey for signing.
 * @param data - The string data to sign.
 * @returns A promise resolving to the signature as a hex string.
 */
async function signData(key: CryptoKey, data: string): Promise<string> {
  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(data),
  );
  // Convert ArrayBuffer to hex string
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies an HMAC-SHA256 signature.
 * @param key - The CryptoKey for verification.
 * @param signatureHex - The signature to verify (hex string).
 * @param data - The original data that was signed.
 * @returns A promise resolving to true if the signature is valid, false otherwise.
 */
async function verifySignature(
  key: CryptoKey,
  signatureHex: string,
  data: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  try {
    // Convert hex signature back to ArrayBuffer
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)),
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.buffer,
      enc.encode(data),
    );
  } catch (error) {
    logError(error, {
      loggerScope: ["cloudflare", "approval-dialog"],
      extra: {
        message: "Error verifying signature",
      },
    });
    return false;
  }
}

/**
 * Parses the signed cookie and verifies its integrity.
 * @param cookieHeader - The value of the Cookie header from the request.
 * @param secret - The secret key used for signing.
 * @returns A promise resolving to the list of approved client IDs if the cookie is valid, otherwise null.
 */
async function getApprovedClientsFromCookie(
  cookieHeader: string | null,
  secret: string,
): Promise<string[] | null> {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const targetCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));

  if (!targetCookie) return null;

  const cookieValue = targetCookie.substring(COOKIE_NAME.length + 1);
  const parts = cookieValue.split(".");

  if (parts.length !== 2) {
    logWarn("Invalid approval cookie format", {
      loggerScope: ["cloudflare", "approval-dialog"],
    });
    return null; // Invalid format
  }

  const [signatureHex, base64Payload] = parts;
  const payload = atob(base64Payload); // Assuming payload is base64 encoded JSON string

  const key = await importKey(secret);
  const isValid = await verifySignature(key, signatureHex, payload);

  if (!isValid) {
    logWarn("Approval cookie signature verification failed", {
      loggerScope: ["cloudflare", "approval-dialog"],
    });
    return null; // Signature invalid
  }

  try {
    const approvedClients = JSON.parse(payload);
    if (!Array.isArray(approvedClients)) {
      logWarn("Approval cookie payload is not an array", {
        loggerScope: ["cloudflare", "approval-dialog"],
      });
      return null; // Payload isn't an array
    }
    // Ensure all elements are strings
    if (!approvedClients.every((item) => typeof item === "string")) {
      logWarn("Approval cookie payload contains non-string elements", {
        loggerScope: ["cloudflare", "approval-dialog"],
      });
      return null;
    }
    return approvedClients as string[];
  } catch (e) {
    logIssue(new Error(`Error parsing cookie payload: ${e}`, { cause: e }));
    return null; // JSON parsing failed
  }
}

/**
 * Checks if a given client ID has already been approved by the user,
 * based on a signed cookie.
 *
 * @param request - The incoming Request object to read cookies from.
 * @param clientId - The OAuth client ID to check approval for.
 * @param cookieSecret - The secret key used to sign/verify the approval cookie.
 * @returns A promise resolving to true if the client ID is in the list of approved clients in a valid cookie, false otherwise.
 */
export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<boolean> {
  if (!clientId) return false;
  const cookieHeader = request.headers.get("Cookie");
  const approvedClients = await getApprovedClientsFromCookie(
    cookieHeader,
    cookieSecret,
  );

  return approvedClients?.includes(clientId) ?? false;
}

/**
 * Configuration for the approval dialog
 */
export interface ApprovalDialogOptions {
  /**
   * Client information to display in the approval dialog
   */
  client: ClientInfo | null;
  /**
   * Server information to display in the approval dialog
   */
  server: {
    name: string;
    logo?: string;
    description?: string;
  };
  /**
   * Arbitrary state data to pass through the approval flow
   * Will be encoded in the form and returned when approval is complete
   */
  state: Record<string, any>;
}

/**
 * Encodes arbitrary data to a URL-safe base64 string.
 * @param data - The data to encode (will be stringified).
 * @returns A URL-safe base64 encoded string.
 */
function encodeState(data: any): string {
  try {
    const jsonString = JSON.stringify(data);
    // Use btoa for simplicity, assuming Worker environment supports it well enough
    // For complex binary data, a Buffer/Uint8Array approach might be better
    return btoa(jsonString);
  } catch (error) {
    logError(error, {
      loggerScope: ["cloudflare", "approval-dialog"],
      extra: {
        message: "Error encoding approval dialog state",
      },
    });
    throw new Error("Could not encode state");
  }
}

/**
 * Decodes a URL-safe base64 string back to its original data.
 * @param encoded - The URL-safe base64 encoded string.
 * @returns The original data.
 */
function decodeState<T = any>(encoded: string): T {
  try {
    const jsonString = atob(encoded);
    return JSON.parse(jsonString);
  } catch (error) {
    logError(error, {
      loggerScope: ["cloudflare", "approval-dialog"],
      extra: {
        message: "Error decoding approval dialog state",
      },
    });
    throw new Error("Could not decode state");
  }
}

/**
 * Renders an approval dialog for OAuth authorization
 * The dialog displays information about the client and server
 * and includes a form to submit approval
 *
 * @param request - The HTTP request
 * @param options - Configuration for the approval dialog
 * @returns A Response containing the HTML approval dialog
 */
export async function renderApprovalDialog(
  request: Request,
  options: ApprovalDialogOptions,
): Promise<Response> {
  const { client, server, state } = options;

  // Use static skill definitions bundled at build time
  const skills: SkillDefinition[] = skillDefinitions as SkillDefinition[];

  // Generate HTML for all skills (checked if defaultEnabled)
  const skillsHtml = skills
    .map(
      (skill) => `
    <label class="permission-item">
      <input type="checkbox" name="skill" value="${sanitizeHtml(skill.id)}"${skill.defaultEnabled ? " checked" : ""}>
      <span class="permission-checkbox"></span>
      <div class="permission-content">
        <div class="permission-header">
          <span class="permission-name">${sanitizeHtml(skill.name)}</span>
          ${skill.toolCount !== undefined ? `<span class="permission-tool-count">${sanitizeHtml(String(skill.toolCount))} ${skill.toolCount === 1 ? "tool" : "tools"}</span>` : ""}
        </div>
        <div class="permission-description">${sanitizeHtml(skill.description)}</div>
      </div>
    </label>
  `,
    )
    .join("");

  // Encode state for form submission
  const encodedState = encodeState(state);

  // Sanitize any untrusted content
  const serverName = sanitizeHtml(server.name);
  const clientName = client?.clientName
    ? sanitizeHtml(client.clientName)
    : "Unknown MCP Client";
  const serverDescription = server.description
    ? sanitizeHtml(server.description)
    : "";

  // Safe URLs
  const logoUrl = server.logo ? sanitizeHtml(server.logo) : "";
  const clientUri = client?.clientUri ? sanitizeHtml(client.clientUri) : "";
  const policyUri = client?.policyUri ? sanitizeHtml(client.policyUri) : "";
  const tosUri = client?.tosUri ? sanitizeHtml(client.tosUri) : "";

  // Client contacts
  const contacts =
    client?.contacts && client.contacts.length > 0
      ? sanitizeHtml(client.contacts.join(", "))
      : "";

  // Get redirect URIs
  const redirectUris =
    client?.redirectUris && client.redirectUris.length > 0
      ? client.redirectUris.map((uri) => sanitizeHtml(uri))
      : [];

  // Generate HTML for the approval dialog
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${clientName} | Authorization Request</title>
        <style>
          /* Modern, responsive styling with system fonts */
          :root {
            /* Color palette */
            --bg-gradient-start: oklch(0.13 0.028 261.692);
            --bg-gradient-mid: oklch(0.18 0.034 264.665);
            --bg-gradient-end: oklch(0.13 0.028 261.692);

            --card-bg: oklch(0.18 0.02 264);
            --card-bg-hover: oklch(0.20 0.02 264);

            --purple-primary: oklch(0.72 0.14 293);
            --purple-hover: oklch(0.76 0.14 293);
            --purple-light: oklch(0.82 0.11 293);

            --border-default: oklch(0.28 0.02 264);
            --border-hover: oklch(0.35 0.05 264);

            --text-primary: oklch(0.95 0 0);
            --text-secondary: oklch(0.75 0.01 264);
            --text-tertiary: oklch(0.60 0.01 264);

            /* Spacing scale */
            --space-xs: 0.25rem;
            --space-sm: 0.5rem;
            --space-md: 1rem;
            --space-lg: 1.5rem;
            --space-xl: 2rem;
            --space-2xl: 3rem;

            /* Border radius */
            --radius-sm: 6px;
            --radius-md: 10px;
            --radius-lg: 14px;

            /* Shadows */
            --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
            --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3);
            --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.4);

            /* Transitions */
            --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
          }

          * {
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                         Helvetica, Arial, sans-serif, "Apple Color Emoji",
                         "Segoe UI Emoji", "Segoe UI Symbol";
            line-height: 1.6;
            color: var(--text-secondary);
            background: linear-gradient(180deg, var(--bg-gradient-start) 0%, var(--bg-gradient-mid) 50%, var(--bg-gradient-end) 100%);
            min-height: 100vh;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          .container {
            max-width: 600px;
            margin: var(--space-xl) auto;
            padding: var(--space-md);
          }

          /* Wider container for two-column layout */
          @media (min-width: 1024px) {
            .container {
              max-width: 1100px;
            }
          }

          .precard {
            text-align: center;
            margin-bottom: var(--space-lg);
          }

          .card {
            background: var(--card-bg);
            padding: var(--space-2xl);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-default);
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-md);
            margin-bottom: var(--space-sm);
          }

          .logo {
            width: 40px;
            height: 40px;
            color: var(--purple-light);
            flex-shrink: 0;
          }

          .title {
            margin: 0;
            font-size: 1.75rem;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.02em;
          }

          .alert {
            margin: 0 0 var(--space-xl) 0;
            font-size: 1.375rem;
            font-weight: 500;
            text-align: center;
            color: var(--text-primary);
            line-height: 1.4;
          }

          .client-info {
            background: rgba(0, 0, 0, 0.25);
            padding: var(--space-md);
            gap: var(--space-md);
            display: flex;
            flex-direction: column;
          }

          .detail-label {
            font-weight: 500;
            color: var(--text-tertiary);
            font-size: 0.875rem;
            margin-bottom: var(--space-xs);
          }

          .detail-value {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            word-break: break-all;
            color: var(--text-secondary);
            font-size: 0.875rem;
          }

          .detail-value.small {
            font-size: 0.8125rem;
          }

          .actions {
            display: flex;
            justify-content: flex-end;
            gap: var(--space-md);
          }

          a {
            color: var(--purple-primary);
            text-decoration: none;
            transition: color var(--transition-fast);
          }

          a:hover {
            color: var(--purple-hover);
            text-decoration: underline;
          }

          .button {
            padding: 0.75rem 1.75rem;
            font-weight: 600;
            cursor: pointer;
            border: none;
            font-size: 0.9375rem;
            border-radius: var(--radius-sm);
            transition: all var(--transition-base);
            font-family: inherit;
            min-height: 44px;
          }

          .button:focus-visible {
            outline: 2px solid var(--purple-primary);
            outline-offset: 2px;
          }

          .button-primary {
            background: var(--purple-primary);
            color: oklch(0.1 0 0);
            box-shadow: var(--shadow-sm);
          }

          .button-primary:hover {
            background: var(--purple-hover);
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
          }

          .button-primary:active {
            transform: translateY(0);
            box-shadow: var(--shadow-sm);
          }

          .button-secondary {
            background: transparent;
            border: 1.5px solid var(--border-default);
            color: var(--text-secondary);
          }

          .button-secondary:hover {
            border-color: var(--border-hover);
            background: rgba(255, 255, 255, 0.03);
            color: var(--text-primary);
          }

          .button-secondary:active {
            background: rgba(255, 255, 255, 0.05);
          }

          /* Section header (for Client, Skills, etc.) */
          .section-header {
            font-size: 1.125rem;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.01em;
            margin: 0;
          }

          /* Permission items */
          .permission-item {
            display: flex;
            align-items: flex-start;
            gap: var(--space-md);
            padding: var(--space-sm) var(--space-md);
            background: transparent;
            border: none;
            border-left: 3px solid transparent;
            margin-bottom: var(--space-sm);
            cursor: pointer;
            transition: all var(--transition-base);
            position: relative;
          }

          .permission-item:last-child {
            margin-bottom: 0;
          }

          .permission-item:hover {
            background: rgba(255, 255, 255, 0.03);
          }

          .permission-item input[type="checkbox"] {
            position: absolute;
            opacity: 0;
            pointer-events: none;
          }

          .permission-checkbox {
            font-size: 1.5rem;
            color: var(--text-tertiary);
            transition: all var(--transition-fast);
            flex-shrink: 0;
            cursor: pointer;
            line-height: 1;
            user-select: none;
          }

          /* Checkbox states */
          .permission-item input[type="checkbox"]:checked + .permission-checkbox {
            color: var(--purple-primary);
            transform: scale(1.1);
          }

          .permission-item input[type="checkbox"]:checked + .permission-checkbox::before {
            content: "☑";
          }

          .permission-item input[type="checkbox"]:not(:checked) + .permission-checkbox::before {
            content: "☐";
          }

          .permission-item:has(input[type="checkbox"]:checked) {
            border-left-color: var(--purple-primary);
            background: rgba(171, 99, 232, 0.05);
          }

          .permission-content {
            flex: 1;
            min-width: 0;
          }

          .permission-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-md);
            margin-bottom: var(--space-xs);
          }

          .permission-name {
            font-weight: 600;
            color: var(--text-primary);
            font-size: 1rem;
            letter-spacing: -0.01em;
          }

          .permission-tool-count {
            font-size: 0.8125rem;
            color: var(--text-tertiary);
            font-weight: 500;
            white-space: nowrap;
            background: rgba(255, 255, 255, 0.05);
            padding: 0.125rem 0.5rem;
            border-radius: 12px;
            border: 1px solid var(--border-default);
          }

          .permission-description {
            color: var(--text-secondary);
            font-size: 0.875rem;
            line-height: 1.5;
          }

          /* Two-column layout for wider screens */
          .approval-grid {
            display: flex;
            flex-direction: column;
            gap: var(--space-xl);
            align-items: start;
          }

          .approval-column {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
          }

          .authorization-text {
            color: var(--text-secondary);
            line-height: 1.6;
          }

          /* Large screens and up: Two-column layout */
          @media (min-width: 1024px) {
            .approval-grid {
              flex-direction: row;
              gap: var(--space-2xl);
            }

            .approval-column {
              flex: 1 1 50%;
            }
          }

          /* Responsive adjustments */
          @media (max-width: 640px) {
            .container {
              margin: var(--space-md) auto;
              padding: var(--space-sm);
            }

            .card {
              padding: var(--space-lg);
              border-radius: var(--radius-md);
            }

            .title {
              font-size: 1.5rem;
            }

            .alert {
              font-size: 1.125rem;
            }

            .actions {
              flex-direction: column-reverse;
              gap: var(--space-sm);
            }

            .button {
              width: 100%;
            }

            .permission-item {
              padding: var(--space-sm);
            }

            .permission-header {
              flex-direction: column;
              align-items: flex-start;
              gap: var(--space-xs);
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header class="precard">
            <div class="header">
              <svg class="logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.48 1.996c.45.26.823.633 1.082 1.083l13.043 22.622a2.962 2.962 0 0 1-2.562 4.44h-3.062c.043-.823.039-1.647 0-2.472h3.052a.488.488 0 0 0 .43-.734L16.418 4.315a.489.489 0 0 0-.845 0L12.582 9.51a23.16 23.16 0 0 1 7.703 8.362 23.19 23.19 0 0 1 2.8 11.024v1.234h-7.882v-1.236a15.284 15.284 0 0 0-6.571-12.543l-1.48 2.567a12.301 12.301 0 0 1 5.105 9.987v1.233h-9.3a2.954 2.954 0 0 1-2.56-1.48A2.963 2.963 0 0 1 .395 25.7l1.864-3.26a6.854 6.854 0 0 1 2.15 1.23l-1.883 3.266a.49.49 0 0 0 .43.734h6.758a9.985 9.985 0 0 0-4.83-7.272l-1.075-.618 3.927-6.835 1.075.615a17.728 17.728 0 0 1 6.164 5.956 17.752 17.752 0 0 1 2.653 8.154h2.959a20.714 20.714 0 0 0-3.05-9.627 20.686 20.686 0 0 0-7.236-7.036l-1.075-.618 4.215-7.309a2.958 2.958 0 0 1 4.038-1.083Z" fill="currentColor"></path></svg>
              <h1 class="title">${serverName}</h1>
            </div>
          </header>

          <main class="card">

            <p class="alert"><strong>${clientName || "A new MCP Client"}</strong> is requesting access</p>

            <form method="post" action="${new URL(request.url).pathname}" aria-label="Authorization form">
              <input type="hidden" name="state" value="${encodedState}">

              <div class="approval-grid">
                <!-- Left column: Skills selection -->
                <div class="approval-column">
                  <h2 class="section-header" id="skills-heading">Skills</h2>
                  <section class="permission-section" aria-labelledby="skills-heading">
                    <div role="group" aria-label="Select skills to grant access">
                      ${skillsHtml}
                    </div>
                  </section>
                </div>

                <!-- Right column: Client info and actions -->
                <div class="approval-column">
                  <h2 class="section-header">Client</h2>
                  <section class="client-info" aria-label="Client Information">
                    <div class="client-detail">
                      <div class="detail-label">Name:</div>
                      <div class="detail-value">
                        ${clientName}
                      </div>
                    </div>

                    ${
                      clientUri
                        ? `
                      <div class="client-detail">
                        <div class="detail-label">Website:</div>
                        <div class="detail-value small">
                          <a href="${clientUri}" target="_blank" rel="noopener noreferrer">
                            ${clientUri}
                          </a>
                        </div>
                      </div>
                    `
                        : ""
                    }

                    ${
                      policyUri
                        ? `
                      <div class="client-detail">
                        <div class="detail-label">Privacy Policy:</div>
                        <div class="detail-value">
                          <a href="${policyUri}" target="_blank" rel="noopener noreferrer">
                            ${policyUri}
                          </a>
                        </div>
                      </div>
                    `
                        : ""
                    }

                    ${
                      tosUri
                        ? `
                      <div class="client-detail">
                        <div class="detail-label">Terms of Service:</div>
                        <div class="detail-value">
                          <a href="${tosUri}" target="_blank" rel="noopener noreferrer">
                            ${tosUri}
                          </a>
                        </div>
                      </div>
                    `
                        : ""
                    }

                    ${
                      redirectUris.length > 0
                        ? `
                      <div class="client-detail">
                        <div class="detail-label">Redirect URIs:</div>
                        <div class="detail-value small">
                          ${redirectUris.map((uri) => `<div>${uri}</div>`).join("")}
                        </div>
                      </div>
                    `
                        : ""
                    }

                    ${
                      contacts
                        ? `
                      <div class="client-detail">
                        <div class="detail-label">Contact:</div>
                        <div class="detail-value">${contacts}</div>
                      </div>
                    `
                        : ""
                    }
                  </section>

                  <p class="authorization-text">This MCP Client is requesting authorization to Sentry. If you approve, you will be redirected to complete authentication.</p>

                  <div class="actions">
                    <button type="button" class="button button-secondary" onclick="window.history.back()" aria-label="Cancel authorization">Cancel</button>
                    <button type="submit" class="button button-primary" aria-label="Approve authorization request">Approve</button>
                  </div>
                </div>
              </div>
            </form>
          </main>
        </div>
      </body>
    </html>
  `;

  return new Response(htmlContent, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * Result of parsing the approval form submission.
 */
export interface ParsedApprovalResult {
  /** The original state object passed through the form. */
  state: any;
  /** Headers to set on the redirect response, including the Set-Cookie header. */
  headers: Record<string, string>;
  /** Selected skills */
  skills: string[];
}

/**
 * Parses the form submission from the approval dialog, extracts the state,
 * and generates Set-Cookie headers to mark the client as approved.
 *
 * @param request - The incoming POST Request object containing the form data.
 * @param cookieSecret - The secret key used to sign the approval cookie.
 * @returns A promise resolving to an object containing the parsed state and necessary headers.
 * @throws If the request method is not POST, form data is invalid, or state is missing.
 */
export async function parseRedirectApproval(
  request: Request,
  cookieSecret: string,
): Promise<ParsedApprovalResult> {
  if (request.method !== "POST") {
    throw new Error("Invalid request method. Expected POST.");
  }

  let state: any;
  let clientId: string | undefined;
  let skills: string[];

  try {
    const formData = await request.formData();
    const encodedState = formData.get("state");

    if (typeof encodedState !== "string" || !encodedState) {
      throw new Error("Missing or invalid 'state' in form data.");
    }

    state = decodeState<{ oauthReqInfo?: AuthRequest }>(encodedState); // Decode the state
    clientId = state?.oauthReqInfo?.clientId; // Extract clientId from within the state

    if (!clientId) {
      throw new Error("Could not extract clientId from state object.");
    }

    // Extract skill selections from checkboxes - collect all 'skill' field values
    skills = formData
      .getAll("skill")
      .filter((s): s is string => typeof s === "string");
  } catch (error) {
    logError(error, {
      loggerScope: ["cloudflare", "approval-dialog"],
      extra: {
        message: "Error processing approval form submission",
      },
    });
    throw new Error(
      `Failed to parse approval form: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Get existing approved clients
  const cookieHeader = request.headers.get("Cookie");
  const existingApprovedClients =
    (await getApprovedClientsFromCookie(cookieHeader, cookieSecret)) || [];

  // Add the newly approved client ID (avoid duplicates)
  const updatedApprovedClients = Array.from(
    new Set([...existingApprovedClients, clientId]),
  );

  // Sign the updated list
  const payload = JSON.stringify(updatedApprovedClients);
  const key = await importKey(cookieSecret);
  const signature = await signData(key, payload);
  const newCookieValue = `${signature}.${btoa(payload)}`; // signature.base64(payload)

  // Generate Set-Cookie header
  const headers: Record<string, string> = {
    "Set-Cookie": `${COOKIE_NAME}=${newCookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`,
  };

  return { state, headers, skills };
}

// sanitizeHtml function is now imported from "./html-utils"
