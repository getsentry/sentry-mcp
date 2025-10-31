import { randomBytes, createHash } from "node:crypto";
import { URL } from "node:url";
import { createServer, type Server } from "node:http";
import open from "open";
import chalk from "chalk";
import {
  OAUTH_REDIRECT_PORT,
  OAUTH_REDIRECT_URI,
  DEFAULT_OAUTH_SCOPES,
} from "../constants.js";
import { logInfo, logSuccess, logToolResult, logError } from "../logger.js";
import { ConfigManager } from "./config.js";

export interface OAuthConfig {
  mcpHost: string;
  scopes?: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface ClientRegistrationResponse {
  client_id: string;
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  registration_client_uri?: string;
  client_id_issued_at?: number;
}

export class OAuthClient {
  private config: OAuthConfig;
  private server: Server | null = null;
  private configManager: ConfigManager;

  constructor(config: OAuthConfig) {
    this.config = {
      ...config,
      scopes: config.scopes || DEFAULT_OAUTH_SCOPES,
    };
    this.configManager = new ConfigManager();
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
  }

  /**
   * Generate random state for CSRF protection
   */
  private generateState(): string {
    return randomBytes(16).toString("base64url");
  }

  /**
   * Register the client with the OAuth server using Dynamic Client Registration
   */
  private async registerClient(): Promise<string> {
    const registrationUrl = `${this.config.mcpHost}/oauth/register`;

    const registrationData = {
      client_name: "Sentry MCP CLI",
      client_uri: "https://github.com/getsentry/sentry-mcp",
      redirect_uris: [OAUTH_REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // PKCE, no client secret
      scope: this.config.scopes!.join(" "),
    };

    const response = await fetch(registrationUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Sentry MCP CLI",
      },
      body: JSON.stringify(registrationData),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Client registration failed: ${response.status} - ${error}`,
      );
    }

    const registrationResponse =
      (await response.json()) as ClientRegistrationResponse;
    return registrationResponse.client_id;
  }

  /**
   * Start local server for OAuth callback
   */
  private async startCallbackServer(): Promise<{
    waitForCallback: () => Promise<{ code: string; state: string }>;
  }> {
    return new Promise((resolve, reject) => {
      let resolveCallback:
        | ((value: { code: string; state: string }) => void)
        | null = null;
      let rejectCallback: ((error: Error) => void) | null = null;

      this.server = createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end("Bad Request");
          return;
        }

        const url = new URL(req.url, `http://localhost:${OAUTH_REDIRECT_PORT}`);

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const error = url.searchParams.get("error");

          if (error) {
            const errorDescription =
              url.searchParams.get("error_description") || "Unknown error";
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head><title>Authentication Failed</title></head>
              <body>
                <h1>Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>${errorDescription}</p>
                <p>You can close this window.</p>
              </body>
              </html>
            `);

            if (rejectCallback) {
              rejectCallback(
                new Error(`OAuth error: ${error} - ${errorDescription}`),
              );
            }
            return;
          }

          if (!code || !state) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head><title>Authentication Failed</title></head>
              <body>
                <h1>Authentication Failed</h1>
                <p>Missing code or state parameter</p>
                <p>You can close this window.</p>
              </body>
              </html>
            `);

            if (rejectCallback) {
              rejectCallback(new Error("Missing code or state parameter"));
            }
            return;
          }

          // Acknowledge the callback but don't show success yet
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication in Progress</title></head>
            <body>
              <h1>Processing Authentication...</h1>
              <p>Please wait while we complete the authentication process.</p>
              <p>You can close this window and return to your terminal.</p>
            </body>
            </html>
          `);

          if (resolveCallback) {
            resolveCallback({ code, state });
          }
        } else {
          res.writeHead(404);
          res.end("Not Found");
        }
      });

      this.server.listen(OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
        const waitForCallback = () =>
          new Promise<{ code: string; state: string }>((res, rej) => {
            resolveCallback = res;
            rejectCallback = rej;
          });

        resolve({ waitForCallback });
      });

      this.server.on("error", reject);
    });
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
  }): Promise<TokenResponse> {
    const tokenUrl = `${this.config.mcpHost}/oauth/token`;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.clientId,
      code: params.code,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: params.codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Sentry MCP CLI",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<TokenResponse>;
  }

  /**
   * Get or register OAuth client ID for the MCP host
   */
  private async getOrRegisterClientId(): Promise<string> {
    // Check if we already have a registered client for this host
    let clientId = await this.configManager.getOAuthClientId(
      this.config.mcpHost,
    );

    if (clientId) {
      return clientId;
    }

    // Register a new client
    logInfo("Registering new OAuth client");
    try {
      clientId = await this.registerClient();

      // Store the client ID for future use
      await this.configManager.setOAuthClientId(this.config.mcpHost, clientId);

      logSuccess("Client registered and saved");
      logToolResult(clientId);
      return clientId;
    } catch (error) {
      throw new Error(
        `Client registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get cached access token or perform OAuth flow
   */
  async getAccessToken(): Promise<string> {
    // Check for cached token first
    const cachedToken = await this.configManager.getAccessToken(
      this.config.mcpHost,
    );
    if (cachedToken) {
      logInfo("Authenticated with Sentry", "using stored token");
      return cachedToken;
    }

    // No cached token, perform OAuth flow
    return this.authenticate();
  }

  /**
   * Perform the OAuth flow
   */
  async authenticate(): Promise<string> {
    // Get or register client ID
    const clientId = await this.getOrRegisterClientId();

    // Start callback server
    const { waitForCallback } = await this.startCallbackServer();

    // Generate PKCE and state
    const { verifier, challenge } = this.generatePKCE();
    const state = this.generateState();

    // Build authorization URL
    const authUrl = new URL(`${this.config.mcpHost}/oauth/authorize`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", this.config.scopes!.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    logInfo("Authenticating with Sentry - opening browser");
    console.log(
      chalk.gray("If your browser doesn't open automatically, visit:"),
    );
    console.log(chalk.white(authUrl.toString()));

    // Open browser
    try {
      await open(authUrl.toString());
    } catch (error) {
      // Browser opening failed, user will need to copy/paste
    }

    try {
      // Wait for callback
      const { code, state: receivedState } = await waitForCallback();

      // Verify state
      if (receivedState !== state) {
        throw new Error("State mismatch - possible CSRF attack");
      }

      // Exchange code for token

      try {
        const tokenResponse = await this.exchangeCodeForToken({
          code,
          codeVerifier: verifier,
          clientId,
        });

        // Cache the access token
        await this.configManager.setAccessToken(
          this.config.mcpHost,
          tokenResponse.access_token,
          tokenResponse.expires_in,
        );

        logSuccess("Authentication successful");

        return tokenResponse.access_token;
      } catch (error) {
        logError(
          "Authentication failed",
          error instanceof Error ? error : String(error),
        );
        throw error;
      }
    } finally {
      // Clean up server
      if (this.server) {
        this.server.close();
        this.server = null;
      }
    }
  }
}
